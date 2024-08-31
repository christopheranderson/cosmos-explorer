import { hashObject } from "../../utils/hashObject";
import { createAggregator } from "../Aggregators";
import { getInitialHeader, mergeHeaders } from "../headerUtils";
import { emptyGroup, extractAggregateResult } from "./emptyGroup";
import { RUCapPerOperationExceededErrorCode } from "../../request/RUCapPerOperationExceededError";
/** @hidden */
export class GroupByEndpointComponent {
    constructor(executionContext, queryInfo) {
        this.executionContext = executionContext;
        this.queryInfo = queryInfo;
        this.groupings = new Map();
        this.aggregateResultArray = [];
        this.completed = false;
    }
    async nextItem(diagnosticNode, operationOptions, ruConsumedManager) {
        // If we have a full result set, begin returning results
        if (this.aggregateResultArray.length > 0) {
            return {
                result: this.aggregateResultArray.pop(),
                headers: getInitialHeader(),
            };
        }
        if (this.completed) {
            return {
                result: undefined,
                headers: getInitialHeader(),
            };
        }
        const aggregateHeaders = getInitialHeader();
        try {
            while (this.executionContext.hasMoreResults()) {
                // Grab the next result
                const { result, headers } = (await this.executionContext.nextItem(diagnosticNode, operationOptions, ruConsumedManager));
                mergeHeaders(aggregateHeaders, headers);
                // If it exists, process it via aggregators
                if (result) {
                    const group = result.groupByItems ? await hashObject(result.groupByItems) : emptyGroup;
                    const aggregators = this.groupings.get(group);
                    const payload = result.payload;
                    if (aggregators) {
                        // Iterator over all results in the payload
                        Object.keys(payload).map((key) => {
                            // in case the value of a group is null make sure we create a dummy payload with item2==null
                            const effectiveGroupByValue = payload[key]
                                ? payload[key]
                                : new Map().set("item2", null);
                            const aggregateResult = extractAggregateResult(effectiveGroupByValue);
                            aggregators.get(key).aggregate(aggregateResult);
                        });
                    }
                    else {
                        // This is the first time we have seen a grouping. Setup the initial result without aggregate values
                        const grouping = new Map();
                        this.groupings.set(group, grouping);
                        // Iterator over all results in the payload
                        Object.keys(payload).map((key) => {
                            const aggregateType = this.queryInfo.groupByAliasToAggregateType[key];
                            // Create a new aggregator for this specific aggregate field
                            const aggregator = createAggregator(aggregateType);
                            grouping.set(key, aggregator);
                            if (aggregateType) {
                                const aggregateResult = extractAggregateResult(payload[key]);
                                aggregator.aggregate(aggregateResult);
                            }
                            else {
                                aggregator.aggregate(payload[key]);
                            }
                        });
                    }
                }
            }
        }
        catch (err) {
            if (err.code === RUCapPerOperationExceededErrorCode) {
                err.fetchedResults = undefined;
            }
            throw err;
        }
        for (const grouping of this.groupings.values()) {
            const groupResult = {};
            for (const [aggregateKey, aggregator] of grouping.entries()) {
                groupResult[aggregateKey] = aggregator.getResult();
            }
            this.aggregateResultArray.push(groupResult);
        }
        this.completed = true;
        return {
            result: this.aggregateResultArray.pop(),
            headers: aggregateHeaders,
        };
    }
    hasMoreResults() {
        return this.executionContext.hasMoreResults() || this.aggregateResultArray.length > 0;
    }
}
//# sourceMappingURL=GroupByEndpointComponent.js.map