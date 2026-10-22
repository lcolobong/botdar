/**
 * Query id registry for X GraphQL operations. X rotates query ids with every web-client release,
 * so an id is resolved from the freshest source first: an id observed in the page's own traffic
 * (relayed as x.graphql.request by the MAIN-world interceptor), then the signed policy's value,
 * then the baked fallback. A 404 from an id marks it stale so the next source takes over.
 */
import { onRelay } from "@/src/core/relay";
import {
  ABOUT_ACCOUNT_OPERATION,
  X_GRAPHQL_OPERATIONS,
  X_GRAPHQL_REQUEST_RELAY_KIND,
} from "./graphqlRoutes";

/**
 * The AboutAccountQuery id shipped with the build. It rotates: this value is only right until X's
 * next web-client release, after which an observed or policy-supplied id must replace it.
 */
export const FALLBACK_ABOUT_ACCOUNT_QUERY_ID = "XRqGa7EeokUU5kppkh13EA";

const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]{15,40}$/;

const FALLBACK_QUERY_IDS: ReadonlyMap<string, string> = new Map([
  [ABOUT_ACCOUNT_OPERATION, FALLBACK_ABOUT_ACCOUNT_QUERY_ID],
]);

export class QueryIdRegistry {
  private readonly observed = new Map<string, string>();
  private readonly stale = new Set<string>();

  /**
   * Records an id seen in page traffic. Only allowlisted operations are kept, so relayed traffic
   * (page-controlled) can neither grow the map without bound nor seed ids for operations the
   * extension never calls; a malformed id is ignored too.
   */
  observe(op: string, queryId: string): void {
    if (!X_GRAPHQL_OPERATIONS.has(op) || !QUERY_ID_PATTERN.test(queryId)) {
      return;
    }
    this.observed.set(op, queryId);
    this.stale.delete(`${op}/${queryId}`);
  }

  /** A 404 proves the id no longer serves this operation; it is skipped until observed again. */
  markStale(op: string, queryId: string): void {
    this.stale.add(`${op}/${queryId}`);
    if (this.observed.get(op) === queryId) {
      this.observed.delete(op);
    }
  }

  /** Observed id, else the policy's, else the baked fallback; undefined when every one is stale. */
  resolve(op: string, policyQueryId?: string): string | undefined {
    const candidates: Array<string | undefined> = [
      this.observed.get(op),
      policyQueryId,
      FALLBACK_QUERY_IDS.get(op),
    ];
    return candidates.find(
      (candidate) =>
        candidate !== undefined &&
        QUERY_ID_PATTERN.test(candidate) &&
        !this.stale.has(`${op}/${candidate}`),
    );
  }

  /** Learns ids from relayed requests; returns the unsubscribe function. */
  startObserving(target: Window = window): () => void {
    return onRelay(
      X_GRAPHQL_REQUEST_RELAY_KIND,
      (envelope) => {
        if (envelope.op !== undefined && envelope.queryId !== undefined) {
          this.observe(envelope.op, envelope.queryId);
        }
      },
      target,
    );
  }
}
