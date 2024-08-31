import { DiagnosticNodeInternal } from "../diagnostics/DiagnosticNodeInternal";
import { ErrorResponse } from "../request";
import { RetryContext } from "./RetryContext";
/**
 * @hidden
 */
export interface RetryPolicy {
    retryAfterInMs: number;
    shouldRetry: (errorResponse: ErrorResponse, diagnosticNode: DiagnosticNodeInternal, retryContext?: RetryContext, locationEndpoint?: string) => Promise<boolean | [boolean, string]>;
}
//# sourceMappingURL=RetryPolicy.d.ts.map