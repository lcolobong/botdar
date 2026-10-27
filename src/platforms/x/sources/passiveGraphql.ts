/**
 * Tier 1 for X: the passive source that turns relayed GraphQL bodies into signals. Bodies arrive
 * from the MAIN-world interceptor and are untrusted page data; the parsers run type guards and
 * never throw, so this source only routes. It is reachable only through the policy merge: the
 * pipeline starts it when `tiers.t1` is on.
 */
import { onRelay } from "@/src/core/relay";
import type { PartialSignals, SignalSource } from "@/src/core/types";
import { ABOUT_ACCOUNT_OPERATION, X_GRAPHQL_RELAY_KIND } from "../graphqlRoutes";
import type { ParsedAboutAccount, ParsedXBody } from "../parsers/graphqlUsers";
import {
  parseAboutAccount,
  parseGraphqlBody,
  postTextByHandle,
  toAboutSignals,
  toSignals,
} from "../parsers/graphqlUsers";

export const PASSIVE_GRAPHQL_SOURCE_ID = "x.graphql";

/**
 * Relayed page data may nudge a score but never sets the declared override (docs/architecture.md,
 * threat model): the Tier 0 Automated label and the Tier 2 About lookup are the only sources of
 * `declaredAutomated`, so a page that forges a relayed body cannot flip a badge to Declared.
 */
function withoutDeclaredOverride(signals: PartialSignals): PartialSignals {
  const relayed: PartialSignals = { ...signals };
  delete relayed.declaredAutomated;
  return relayed;
}

export function createPassiveGraphqlSource(target: Window = window): SignalSource {
  return {
    id: PASSIVE_GRAPHQL_SOURCE_ID,
    platform: "x",
    tier: 1,
    kind: "passive",
    start: (emit) =>
      onRelay(
        X_GRAPHQL_RELAY_KIND,
        (envelope) => {
          const parsed: ParsedXBody = parseGraphqlBody(envelope.body);
          const postTexts: Map<string, string> = postTextByHandle(parsed.posts);
          for (const user of parsed.users) {
            const signals: PartialSignals = withoutDeclaredOverride(toSignals(user));
            const postText: string | undefined = postTexts.get(user.ref.handle);
            emit(user.ref, postText === undefined ? signals : { ...signals, postText });
          }
          if (envelope.op !== ABOUT_ACCOUNT_OPERATION) {
            return;
          }
          const about: ParsedAboutAccount | null = parseAboutAccount(envelope.body);
          if (about !== null) {
            emit(
              { platform: "x", handle: about.handle },
              withoutDeclaredOverride(toAboutSignals(about)),
            );
          }
        },
        target,
      ),
  };
}
