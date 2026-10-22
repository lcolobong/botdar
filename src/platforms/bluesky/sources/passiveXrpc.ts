/**
 * Tier 1 for Bluesky: the author views in the feed, thread and profile responses the web app already
 * fetched for itself, delivered through the relay (ADR-0011). Zero extra requests; every body is
 * untrusted page data and goes through the fixture-tested parsers.
 */
import { onRelay } from "../../../core/relay";
import type { RelayEnvelope } from "../../../core/relay";
import type { PartialSignals, SignalEmitter, SignalSource } from "../../../core/types";
import { parseFeedAuthors, parseProfiles } from "../parsers/profiles";
import type { ParsedBlueskyProfile } from "../parsers/profiles";
import { BLUESKY_RELAY_KIND, FEED_OPERATIONS, PROFILE_OPERATIONS } from "../xrpc";

export const PASSIVE_XRPC_SOURCE_ID = "bluesky.xrpc";

/**
 * Relayed page data may nudge a score but never sets the declared override (docs/architecture.md,
 * threat model): the Tier 0 robot badge and the Tier 2 getProfiles labels are the only sources of
 * `declaredAutomated`, so a page that forges a relayed body cannot flip a badge to Declared.
 */
function withoutDeclaredOverride(signals: PartialSignals): PartialSignals {
  const relayed: PartialSignals = { ...signals };
  delete relayed.declaredAutomated;
  return relayed;
}

function profilesIn(envelope: RelayEnvelope): ParsedBlueskyProfile[] {
  if (envelope.op !== undefined && PROFILE_OPERATIONS.includes(envelope.op)) {
    return parseProfiles(envelope.body);
  }
  if (envelope.op !== undefined && FEED_OPERATIONS.includes(envelope.op)) {
    return parseFeedAuthors(envelope.body);
  }
  return [];
}

export function createPassiveXrpcSource(target: Window = window): SignalSource {
  return {
    id: PASSIVE_XRPC_SOURCE_ID,
    platform: "bluesky",
    tier: 1,
    kind: "passive",
    start: (emit: SignalEmitter): (() => void) =>
      onRelay(
        BLUESKY_RELAY_KIND,
        (envelope: RelayEnvelope): void => {
          for (const profile of profilesIn(envelope)) {
            emit(profile.ref, withoutDeclaredOverride(profile.signals));
          }
        },
        target,
      ),
  };
}
