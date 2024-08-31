// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { CosmosDiagnosticContext } from "./CosmosDiagnosticsContext";
import { v4 } from "uuid";
import { CosmosDiagnostics, getRootNode, } from "../CosmosDiagnostics";
import { getCurrentTimestampInMs } from "../utils/time";
import { CosmosDbDiagnosticLevel } from "./CosmosDbDiagnosticLevel";
import { Constants, prepareURL } from "../common";
import { allowTracing } from "./diagnosticLevelComparator";
/**
 * @hidden
 * This is Internal Representation for DiagnosticNode. It contains useful helper functions to collect
 * diagnostic information throughout the lifetime of Diagnostic session.
 * The functions toDiagnosticNode() & toDiagnostic() are given to convert it to public facing counterpart.
 */
export class DiagnosticNodeInternal {
    /**
     * @internal
     */
    constructor(diagnosticLevel, type, parent, data = {}, startTimeUTCInMs = getCurrentTimestampInMs(), ctx = new CosmosDiagnosticContext()) {
        this.id = v4();
        this.nodeType = type;
        this.startTimeUTCInMs = startTimeUTCInMs;
        this.data = data;
        this.children = [];
        this.durationInMs = 0;
        this.parent = parent;
        this.diagnosticCtx = ctx;
        this.diagnosticLevel = diagnosticLevel;
    }
    /**
     * @internal
     */
    addLog(msg) {
        if (!this.data.log) {
            this.data.log = [];
        }
        this.data.log.push(msg);
    }
    /**
     * @internal
     */
    sanitizeHeaders(headers) {
        return headers;
    }
    /**
     * Updated durationInMs for node, based on endTimeUTCInMs provided.
     * @internal
     */
    updateTimestamp(endTimeUTCInMs = getCurrentTimestampInMs()) {
        this.durationInMs = endTimeUTCInMs - this.startTimeUTCInMs;
    }
    /**
     * @internal
     */
    recordSuccessfulNetworkCall(startTimeUTCInMs, requestContext, pipelineResponse, substatus, url) {
        const responseHeaders = pipelineResponse.headers.toJSON();
        const gatewayRequest = {
            activityId: responseHeaders[Constants.HttpHeaders.ActivityId],
            startTimeUTCInMs,
            durationInMs: getCurrentTimestampInMs() - startTimeUTCInMs,
            statusCode: pipelineResponse.status,
            subStatusCode: substatus,
            requestPayloadLengthInBytes: calculateRequestPayloadLength(requestContext),
            responsePayloadLengthInBytes: calculateResponsePayloadLength(pipelineResponse),
            operationType: requestContext.operationType,
            resourceType: requestContext.resourceType,
            partitionKeyRangeId: requestContext.partitionKeyRangeId,
        };
        let requestData = {
            OperationType: gatewayRequest.operationType,
            resourceType: gatewayRequest.resourceType,
            requestPayloadLengthInBytes: gatewayRequest.requestPayloadLengthInBytes,
        };
        if (allowTracing(CosmosDbDiagnosticLevel.debugUnsafe, this.diagnosticLevel)) {
            requestData = Object.assign(Object.assign({}, requestData), { headers: this.sanitizeHeaders(requestContext.headers), requestBody: requestContext.body, responseBody: pipelineResponse.bodyAsText, url: url });
        }
        this.addData({
            requestPayloadLengthInBytes: gatewayRequest.requestPayloadLengthInBytes,
            responsePayloadLengthInBytes: gatewayRequest.responsePayloadLengthInBytes,
            startTimeUTCInMs: gatewayRequest.startTimeUTCInMs,
            durationInMs: gatewayRequest.durationInMs,
            requestData,
        });
        this.diagnosticCtx.recordNetworkCall(gatewayRequest);
    }
    /**
     * @internal
     */
    recordFailedNetworkCall(startTimeUTCInMs, requestContext, retryAttemptNumber, statusCode, substatusCode, responseHeaders) {
        this.addData({ failedAttempty: true });
        const requestPayloadLengthInBytes = calculateRequestPayloadLength(requestContext);
        this.diagnosticCtx.recordFailedAttempt({
            activityId: responseHeaders[Constants.HttpHeaders.ActivityId],
            startTimeUTCInMs,
            durationInMs: getCurrentTimestampInMs() - startTimeUTCInMs,
            statusCode,
            subStatusCode: substatusCode,
            requestPayloadLengthInBytes,
            responsePayloadLengthInBytes: 0,
            operationType: requestContext.operationType,
            resourceType: requestContext.resourceType,
        }, retryAttemptNumber);
        let requestData = {
            OperationType: requestContext.operationType,
            resourceType: requestContext.resourceType,
            requestPayloadLengthInBytes,
        };
        if (allowTracing(CosmosDbDiagnosticLevel.debugUnsafe, this.diagnosticLevel)) {
            requestData = Object.assign(Object.assign({}, requestData), { headers: this.sanitizeHeaders(requestContext.headers), requestBody: requestContext.body, url: prepareURL(requestContext.endpoint, requestContext.path) });
        }
        this.addData({
            failedAttempty: true,
            requestData,
        });
    }
    /**
     * @internal
     */
    recordEndpointResolution(location) {
        this.addData({ selectedLocation: location });
        this.diagnosticCtx.recordEndpointResolution(location);
    }
    /**
     * @internal
     */
    addData(data, msg, level = this.diagnosticLevel) {
        if (level !== CosmosDbDiagnosticLevel.info) {
            this.data = Object.assign(Object.assign({}, this.data), data);
            if (msg) {
                this.addLog(msg);
            }
        }
    }
    /**
     * Merge given DiagnosticNodeInternal's context to current node's DiagnosticContext, Treating GatewayRequests of
     * given DiagnosticContext, as metadata requests. Given DiagnosticNodeInternal becomes a child of this node.
     * @internal
     */
    addChildNode(child, level, metadataType) {
        this.diagnosticCtx.mergeDiagnostics(child.diagnosticCtx, metadataType);
        if (allowTracing(level, this.diagnosticLevel)) {
            child.parent = this;
            this.children.push(child);
        }
        return child;
    }
    /**
     * @internal
     */
    initializeChildNode(type, level, data = {}) {
        if (allowTracing(level, this.diagnosticLevel)) {
            const child = new DiagnosticNodeInternal(this.diagnosticLevel, type, this, data, getCurrentTimestampInMs(), this.diagnosticCtx);
            this.children.push(child);
            return child;
        }
        else {
            return this;
        }
    }
    /**
     * @internal
     */
    recordQueryResult(resources, level) {
        var _a;
        if (allowTracing(level, this.diagnosticLevel)) {
            const previousCount = (_a = this.data.queryRecordsRead) !== null && _a !== void 0 ? _a : 0;
            if (Array.isArray(resources)) {
                this.data.queryRecordsRead = previousCount + resources.length;
            }
        }
    }
    /**
     * Convert DiagnosticNodeInternal (internal representation) to DiagnosticNode (public, sanitized representation)
     * @internal
     */
    toDiagnosticNode() {
        return {
            id: this.id,
            nodeType: this.nodeType,
            children: this.children.map((child) => child.toDiagnosticNode()),
            data: this.data,
            startTimeUTCInMs: this.startTimeUTCInMs,
            durationInMs: this.durationInMs,
        };
    }
    /**
     * Convert to CosmosDiagnostics
     * @internal
     */
    toDiagnostic(clientConfigDiagnostic) {
        const rootNode = getRootNode(this);
        const diagnostiNode = allowTracing(CosmosDbDiagnosticLevel.debug, this.diagnosticLevel)
            ? rootNode.toDiagnosticNode()
            : undefined;
        const clientConfig = allowTracing(CosmosDbDiagnosticLevel.debug, this.diagnosticLevel)
            ? clientConfigDiagnostic
            : undefined;
        const cosmosDiagnostic = new CosmosDiagnostics(this.diagnosticCtx.getClientSideStats(), diagnostiNode, clientConfig);
        return cosmosDiagnostic;
    }
}
/**
 * @hidden
 */
export var DiagnosticNodeType;
(function (DiagnosticNodeType) {
    DiagnosticNodeType["CLIENT_REQUEST_NODE"] = "CLIENT_REQUEST_NODE";
    DiagnosticNodeType["METADATA_REQUEST_NODE"] = "METADATA_REQUEST_NODE";
    DiagnosticNodeType["HTTP_REQUEST"] = "HTTP_REQUEST";
    DiagnosticNodeType["BATCH_REQUEST"] = "BATCH_REQUEST";
    DiagnosticNodeType["PARALLEL_QUERY_NODE"] = "PARALLEL_QUERY_NODE";
    DiagnosticNodeType["DEFAULT_QUERY_NODE"] = "DEFAULT_QUERY_NODE";
    DiagnosticNodeType["QUERY_REPAIR_NODE"] = "QUERY_REPAIR_NODE";
    DiagnosticNodeType["BACKGROUND_REFRESH_THREAD"] = "BACKGROUND_REFRESH_THREAD";
    DiagnosticNodeType["REQUEST_ATTEMPTS"] = "REQUEST_ATTEMPTS";
})(DiagnosticNodeType || (DiagnosticNodeType = {}));
function calculateResponsePayloadLength(response) {
    var _a;
    return ((_a = response === null || response === void 0 ? void 0 : response.bodyAsText) === null || _a === void 0 ? void 0 : _a.length) || 0;
}
function calculateRequestPayloadLength(requestContext) {
    return requestContext.body ? requestContext.body.length : 0;
}
//# sourceMappingURL=DiagnosticNodeInternal.js.map