/**
 * Per-page counters of what the content script saw and did, read by the popup's diagnostics
 * section. They exist so a broken selector reads as "12 found, 0 badged, 12 without an anchor"
 * instead of "no badges": the first live test on Reddit (2026-10-25) took a day of console pastes
 * to reach that sentence. Elements are tracked in WeakMaps keyed by element so an item the
 * observer retries on every pass counts once, an item first seen under one kind and later resolved
 * as another moves between buckets, and nothing here references an account (ADR-0012).
 */
import type { PostRef } from "./types.ts";

export type DiagnosticsKind = "post" | "comment" | "reply";
export type LookupOutcome = "started" | "cached" | "delivered" | "empty" | "rateLimited" | "failed";

export interface KindCounts {
  /** Feed items the observer found, with or without a usable author row. */
  seen: number;
  /** Items that have had a badge mounted at least once. */
  badged: number;
  /** Items found but currently without an author anchor; the observer retries them. */
  anchorMisses: number;
}

export interface DiagnosticsStats {
  startedAt: number;
  kinds: Record<DiagnosticsKind, KindCounts>;
  lookups: Record<LookupOutcome, number>;
}

export const DIAGNOSTICS_KINDS: readonly DiagnosticsKind[] = ["post", "comment", "reply"];
export const LOOKUP_OUTCOMES: readonly LookupOutcome[] = [
  "started",
  "cached",
  "delivered",
  "empty",
  "rateLimited",
  "failed",
];

function emptyStats(startedAt: number): DiagnosticsStats {
  const kinds = {} as Record<DiagnosticsKind, KindCounts>;
  for (const kind of DIAGNOSTICS_KINDS) kinds[kind] = { seen: 0, badged: 0, anchorMisses: 0 };
  const lookups = {} as Record<LookupOutcome, number>;
  for (const outcome of LOOKUP_OUTCOMES) lookups[outcome] = 0;
  return { startedAt, kinds, lookups };
}

let stats: DiagnosticsStats = emptyStats(Date.now());
let seenKind = new WeakMap<Element, DiagnosticsKind>();
let missedKind = new WeakMap<Element, DiagnosticsKind>();
let badgedElements = new WeakSet<Element>();

/** Reddit comments are their own kind; elsewhere a reply is the only distinction the DOM offers. */
export function kindOfPost(post: PostRef): DiagnosticsKind {
  if (post.kind === "comment") return "comment";
  return post.isReply ? "reply" : "post";
}

/**
 * An item the observer found. Clears an earlier anchor miss for the same element, from the bucket
 * the miss was recorded under: an X article can miss as a "post" before its author row renders and
 * resolve as a "reply" once it has.
 */
export function recordSeen(kind: DiagnosticsKind, element: Element): void {
  const missedAs: DiagnosticsKind | undefined = missedKind.get(element);
  if (missedAs !== undefined) {
    missedKind.delete(element);
    stats.kinds[missedAs].anchorMisses -= 1;
  }
  const seenAs: DiagnosticsKind | undefined = seenKind.get(element);
  if (seenAs === kind) return;
  if (seenAs !== undefined) stats.kinds[seenAs].seen -= 1;
  seenKind.set(element, kind);
  stats.kinds[kind].seen += 1;
}

/** An item found without an anchor for its author; counted once however often it is retried. */
export function recordAnchorMiss(kind: DiagnosticsKind, element: Element): void {
  recordSeen(kind, element);
  if (missedKind.has(element)) return;
  missedKind.set(element, kind);
  stats.kinds[kind].anchorMisses += 1;
}

export function recordBadged(kind: DiagnosticsKind, element: Element): void {
  if (badgedElements.has(element)) return;
  badgedElements.add(element);
  stats.kinds[kind].badged += 1;
}

export function recordLookup(outcome: LookupOutcome): void {
  stats.lookups[outcome] += 1;
}

export function diagnosticsSnapshot(): DiagnosticsStats {
  return structuredClone(stats);
}

export function resetDiagnostics(now: number = Date.now()): void {
  stats = emptyStats(now);
  seenKind = new WeakMap<Element, DiagnosticsKind>();
  missedKind = new WeakMap<Element, DiagnosticsKind>();
  badgedElements = new WeakSet<Element>();
}
