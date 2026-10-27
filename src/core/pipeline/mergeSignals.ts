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

/** Whether a field was accepted from this tier, and whether its value or tier changed. */
interface MergeOutcome {
  accepted: boolean;
  changed: boolean;
}

/**
 * How one field folds an incoming value into the target. The whole merge signature is passed because
 * strategies differ in more than how they combine values: the gathering strategies skip the "older
 * observation" check and keep the latest observation time, and timestamps also normalise their result.
 */
type FieldMerge = (
  target: MergeableSignals,
  field: SignalField,
  incoming: unknown,
  tier: SourceTier,
  observedAt: number,
) => MergeOutcome;

const REJECTED: Readonly<MergeOutcome> = Object.freeze({ accepted: false, changed: false });

/** A lower tier never overwrites, nor adds to, a higher tier's value, so provenance stays truthful. */
function isOutranked(target: MergeableSignals, field: SignalField, tier: SourceTier): boolean {
  const existingTier: SourceTier | undefined = target.signals.provenance[field];
  return existingTier !== undefined && tier < existingTier;
}

function fieldState(
  target: MergeableSignals,
  field: SignalField,
  tier: SourceTier,
): { sameTier: boolean; existingObservedAt: number } {
  return {
    sameTier: target.signals.provenance[field] === tier,
    existingObservedAt: target.fieldObservedAt[field] ?? 0,
  };
}

/** Stores an accepted value; the caller decides which observation time the field keeps. */
function commit(
  target: MergeableSignals,
  field: SignalField,
  value: unknown,
  tier: SourceTier,
  recordedObservedAt: number,
): MergeOutcome {
  const changed: boolean =
    target.signals.provenance[field] !== tier || !sameSignalValue(target.signals[field], value);
  Object.assign(target.signals, { [field]: value });
  target.signals.provenance[field] = tier;
  target.fieldObservedAt[field] = recordedObservedAt;
  return { accepted: true, changed };
}

/** The default rule: a higher tier overwrites, within a tier the newer observation wins. */
const newerWins: FieldMerge = (target, field, incoming, tier, observedAt) => {
  const { sameTier, existingObservedAt } = fieldState(target, field, tier);
  if (isOutranked(target, field, tier) || (sameTier && observedAt < existingObservedAt)) {
    return REJECTED;
  }
  return commit(target, field, incoming, tier, observedAt);
};

/**
 * Post text gathers instead of being replaced within a tier: each response carries a few of an
 * author's posts, and a later body with one short reply must not wipe a profile page's sample and
 * flip the language read. New text is appended, unless the sample already holds it, up to the cap;
 * a higher tier's text replaces a lower tier's, as for every field. Every stored sample is capped,
 * so adapters need not pre-cap what they extract.
 */
const gatherText: FieldMerge = (target, field, incoming, tier, observedAt) => {
  if (typeof incoming !== "string" || isOutranked(target, field, tier)) {
    return REJECTED;
  }
  const { sameTier, existingObservedAt } = fieldState(target, field, tier);
  const existing: unknown = target.signals[field];
  const capped: string = incoming.slice(0, MAX_POST_TEXT_LENGTH);
  const gathered: string =
    sameTier && typeof existing === "string"
      ? existing.includes(capped)
        ? existing
        : `${existing}\n${capped}`.slice(0, MAX_POST_TEXT_LENGTH)
      : capped;
  return commit(
    target,
    field,
    gathered,
    tier,
    sameTier ? Math.max(existingObservedAt, observedAt) : observedAt,
  );
};

/**
 * Post timestamps follow the tier-merge rule with one difference: within a tier they add up instead
 * of the newer observation winning, because a profile timeline arrives a page at a time. A higher
 * tier's set replaces a lower tier's (Tier 1 bodies are page-controlled, a Tier 2 lookup is not),
 * and a lower tier never adds to a higher one, so the provenance is always the tier whose set is in
 * use. The result is normalised once here; the cadence statistics trust it.
 */
const accumulateTimestamps: FieldMerge = (target, field, incoming, tier, observedAt) => {
  if (!Array.isArray(incoming) || isOutranked(target, field, tier)) {
    return REJECTED;
  }
  const { sameTier, existingObservedAt } = fieldState(target, field, tier);
  const existing: unknown = target.signals[field];
  const base: unknown[] = sameTier && Array.isArray(existing) ? existing : [];
  const merged: number[] = normalisePostTimestamps([...base, ...incoming] as number[], observedAt);
  return commit(target, field, merged, tier, Math.max(existingObservedAt, observedAt));
};

/** Only the fields whose within-tier rule differs from `newerWins`; a new exception is added here. */
const FIELD_MERGES: Readonly<Partial<Record<SignalField, FieldMerge>>> = Object.freeze({
  postText: gatherText,
  postTimestamps: accumulateTimestamps,
});

/**
 * Tier-merge rule: a higher tier overwrites a lower tier's value for the same field; within the same
 * tier the newer observation wins unless the field has its own rule in `FIELD_MERGES`; a lower tier
 * never overwrites. Returns whether a value or its tier changed, which is all scoring reads:
 * re-observing the same value only refreshes the times.
 */
export function mergeSignals(
  target: MergeableSignals,
  incoming: PartialSignals,
  tier: SourceTier,
  observedAt: number,
): boolean {
  let accepted = false;
  let changed = false;
  for (const [key, observed] of Object.entries(incoming)) {
    if (observed === undefined || RESERVED_FIELDS.has(key)) {
      continue;
    }
    const field = key as SignalField;
    const merge: FieldMerge = FIELD_MERGES[field] ?? newerWins;
    const outcome: MergeOutcome = merge(target, field, observed, tier, observedAt);
    accepted ||= outcome.accepted;
    changed ||= outcome.changed;
  }
  if (accepted) {
    target.signals.observedAt = Math.max(target.signals.observedAt, observedAt);
  }
  return changed;
}
