/**
 * The tier-merge rule (docs/architecture.md, "AccountResolver pipeline"): how a source's partial
 * signals fold into what the resolver already holds for an account.
 */
import { normalisePostTimestamps } from "../scoring/cadence";
import { MAX_POST_TEXT_LENGTH } from "../types";
import type { AccountSignals, PartialSignals, SignalField, SourceTier } from "../types";

export interface MergeableSignals {
  signals: AccountSignals;
  /** When each field was last observed, for the same-tier "newer wins" rule. */
  fieldObservedAt: Partial<Record<SignalField, number>>;
}

const RESERVED_FIELDS: ReadonlySet<string> = new Set([
  "ref",
  "provenance",
  "tiersDelivered",
  "observedAt",
]);

/**
 * Field values are primitives, one flat object (`replyShare`) or one array of numbers
 * (`postTimestamps`), so a shallow comparison is exact.
 */
function sameSignalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  const leftEntries: Array<[string, unknown]> = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => Object.is(value, (right as Record<string, unknown>)[key]))
  );
}

/** Records that a tier delivered data for the account; false when it was already recorded. */
export function markDelivered(signals: AccountSignals, tier: SourceTier): boolean {
  if (signals.tiersDelivered.includes(tier)) {
    return false;
  }
  signals.tiersDelivered = [...signals.tiersDelivered, tier].sort();
  return true;
}

/**
 * Post text gathers instead of being replaced within a tier: each response carries a few of an
 * author's posts, and a later body with one short reply must not wipe a profile page's sample and
 * flip the language read. New text is appended, unless the sample already holds it, up to the cap;
 * a higher tier's text replaces a lower tier's, as for every field.
 */
function gatheredPostText(existing: string | undefined, incoming: string): string {
  if (existing === undefined || existing.includes(incoming)) {
    return existing ?? incoming.slice(0, MAX_POST_TEXT_LENGTH);
  }
  return `${existing}\n${incoming}`.slice(0, MAX_POST_TEXT_LENGTH);
}

/**
 * Post timestamps follow the tier-merge rule with one difference: within a tier they add up instead
 * of the newer observation winning, because a profile timeline arrives a page at a time. A higher
 * tier's set replaces a lower tier's (Tier 1 bodies are page-controlled, a Tier 2 lookup is not),
 * and a lower tier never adds to a higher one, so the provenance is always the tier whose set is in
 * use. The result is normalised once here; the cadence statistics trust it. Returns whether the
 * set was taken and whether it changed.
 */
function mergePostTimestamps(
  target: MergeableSignals,
  incoming: number[],
  tier: SourceTier,
  observedAt: number,
): { accepted: boolean; changed: boolean } {
  const existingTier: SourceTier | undefined = target.signals.provenance.postTimestamps;
  if (existingTier !== undefined && tier < existingTier) {
    return { accepted: false, changed: false };
  }
  const base: number[] = existingTier === tier ? (target.signals.postTimestamps ?? []) : [];
  const merged: number[] = normalisePostTimestamps([...base, ...incoming], observedAt);
  const changed: boolean =
    existingTier !== tier || !sameSignalValue(target.signals.postTimestamps, merged);
  target.signals.postTimestamps = merged;
  target.signals.provenance.postTimestamps = tier;
  target.fieldObservedAt.postTimestamps = Math.max(
    target.fieldObservedAt.postTimestamps ?? 0,
    observedAt,
  );
  return { accepted: true, changed };
}

/**
 * Tier-merge rule: a higher tier overwrites a lower tier's value for the same field; within the same
 * tier the newer observation wins (post text gathers, `gatheredPostText`); a lower tier never
 * overwrites. Post timestamps accumulate within a tier too (`mergePostTimestamps`). Returns whether a
 * value or its tier changed, which is all scoring reads: re-observing the same value only refreshes
 * the times.
 */
export function mergeSignals(
  target: MergeableSignals,
  incoming: PartialSignals,
  tier: SourceTier,
  observedAt: number,
): boolean {
  const { postTimestamps, ...replacing } = incoming;
  const timestamps: { accepted: boolean; changed: boolean } =
    postTimestamps === undefined
      ? { accepted: false, changed: false }
      : mergePostTimestamps(target, postTimestamps, tier, observedAt);
  let accepted: boolean = timestamps.accepted;
  let changed: boolean = timestamps.changed;
  for (const [key, observed] of Object.entries(replacing)) {
    if (observed === undefined || RESERVED_FIELDS.has(key)) {
      continue;
    }
    const field = key as SignalField;
    const existingTier: SourceTier | undefined = target.signals.provenance[field];
    const existingObservedAt: number = target.fieldObservedAt[field] ?? 0;
    const outranked: boolean = existingTier !== undefined && tier < existingTier;
    const gathers: boolean = field === "postText" && existingTier === tier;
    const older: boolean = existingTier === tier && observedAt < existingObservedAt;
    if (outranked || (older && !gathers)) {
      continue;
    }
    const value: unknown =
      gathers && typeof observed === "string"
        ? gatheredPostText(target.signals.postText, observed)
        : observed;
    if (existingTier !== tier || !sameSignalValue(target.signals[field], value)) {
      changed = true;
    }
    Object.assign(target.signals, { [field]: value });
    target.signals.provenance[field] = tier;
    target.fieldObservedAt[field] = gathers ? Math.max(existingObservedAt, observedAt) : observedAt;
    accepted = true;
  }
  if (accepted) {
    target.signals.observedAt = Math.max(target.signals.observedAt, observedAt);
  }
  return changed;
}
