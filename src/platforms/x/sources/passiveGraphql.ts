/**
 * Tier 1 for X: the passive source that turns relayed GraphQL bodies into signals. Bodies arrive
 * from the MAIN-world interceptor and are untrusted page data; the parsers run type guards and
 * never throw, so this source only routes. It is reachable only through the policy merge: the
 * pipeline starts it when `tiers.t1` is on.
 */
import { onRelay } from "@/src/core/relay";
import type { PartialSignals, SignalSource } from "@/src/core/types";
import {
  ABOUT_ACCOUNT_OPERATION,
  PROFILE_TIMELINE_OPERATION,
  X_GRAPHQL_RELAY_KIND,
} from "../graphqlRoutes";
import type { ParsedAboutAccount, ParsedXBody, TimelineOwnerPosts } from "../parsers/graphqlUsers";
import {
  parseAboutAccount,
  parseGraphqlBody,
  postTextByHandle,
  profileTimelineUserIdOf,
  timelineOwnerPosts,
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

/**
 * What a body's posts say about their authors: each author's post text, and on the profile's posts
 * tab (`UserTweets`) the owner's post times, the owner being the user the request named. Post times
 * from any other operation are a feed's, a thread's or the replies tab's sample, a different
 * population from the one the cadence features read, and are left out.
 */
function postSignalsByHandle(
  parsed: ParsedXBody,
  op: string | undefined,
  query: string | undefined,
): Map<string, PartialSignals> {
  const signalsByHandle = new Map<string, PartialSignals>();
  for (const [handle, postText] of postTextByHandle(parsed.posts)) {
    signalsByHandle.set(handle, { postText });
  }
  const owner: TimelineOwnerPosts | undefined =
    op === PROFILE_TIMELINE_OPERATION
      ? timelineOwnerPosts(parsed.posts, profileTimelineUserIdOf(query))
      : undefined;
  if (owner !== undefined) {
    signalsByHandle.set(owner.handle, {
      ...signalsByHandle.get(owner.handle),
      postTimestamps: owner.timestamps,
    });
  }
  return signalsByHandle;
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
          const postSignals: Map<string, PartialSignals> = postSignalsByHandle(
            parsed,
            envelope.op,
            envelope.query,
          );
          for (const user of parsed.users) {
            emit(user.ref, {
              ...withoutDeclaredOverride(toSignals(user)),
              ...postSignals.get(user.ref.handle),
            });
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
