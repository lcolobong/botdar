/**
 * The "This looks wrong" feedback store: the only persisted data that references an account
 * (ADR-0012). Entries are created by the user, kept in `storage.local`, exportable as JSON from the
 * options page, and never transmitted anywhere.
 */

import { browser } from "wxt/browser";
import { isPlatformId } from "./messaging";
import type { PlatformId, VerdictTier } from "./types";

export const FEEDBACK_STORAGE_KEY = "feedback.v1";
export const FEEDBACK_CAP = 500;
export const FEEDBACK_EXPORT_SCHEMA = 1;

export interface FeedbackInput {
  platform: PlatformId;
  handle: string;
  tier: VerdictTier;
  reasons: string[];
  computedAt: number;
}

export interface FeedbackEntry extends FeedbackInput {
  id: string;
  recordedAt: number;
}

export interface FeedbackExport {
  schema: typeof FEEDBACK_EXPORT_SCHEMA;
  exportedAt: string;
  entries: FeedbackEntry[];
}

const VERDICT_TIERS: readonly VerdictTier[] = ["typical", "some", "many", "declared", "unknown"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export function isFeedbackEntry(value: unknown): value is FeedbackEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isPlatformId(value.platform) &&
    typeof value.handle === "string" &&
    typeof value.tier === "string" &&
    (VERDICT_TIERS as readonly string[]).includes(value.tier) &&
    isStringArray(value.reasons) &&
    typeof value.computedAt === "number" &&
    typeof value.recordedAt === "number"
  );
}

/** Storage contents are on-disk data and may be stale or hand-edited: invalid entries are dropped. */
async function loadEntries(): Promise<FeedbackEntry[]> {
  const stored: Record<string, unknown> = await browser.storage.local.get(FEEDBACK_STORAGE_KEY);
  const raw: unknown = stored[FEEDBACK_STORAGE_KEY];
  return Array.isArray(raw) ? raw.filter(isFeedbackEntry) : [];
}

async function saveEntries(entries: FeedbackEntry[]): Promise<void> {
  await browser.storage.local.set({ [FEEDBACK_STORAGE_KEY]: entries });
}

/** Appends an entry; when the cap is exceeded the oldest entries are dropped. */
export async function recordFeedback(
  input: FeedbackInput,
  now: () => number = Date.now,
): Promise<FeedbackEntry> {
  const entry: FeedbackEntry = {
    ...input,
    reasons: [...input.reasons],
    id: crypto.randomUUID(),
    recordedAt: now(),
  };
  const entries: FeedbackEntry[] = await loadEntries();
  entries.push(entry);
  await saveEntries(entries.slice(-FEEDBACK_CAP));
  return entry;
}

/** Entries in recording order, oldest first. */
export async function listFeedback(): Promise<FeedbackEntry[]> {
  return loadEntries();
}

export async function removeFeedback(id: string): Promise<boolean> {
  const entries: FeedbackEntry[] = await loadEntries();
  const remaining: FeedbackEntry[] = entries.filter((entry) => entry.id !== id);
  if (remaining.length === entries.length) {
    return false;
  }
  await saveEntries(remaining);
  return true;
}

export async function clearFeedback(): Promise<void> {
  await browser.storage.local.remove(FEEDBACK_STORAGE_KEY);
}

/** Pretty-printed JSON for the options page download; the schema header lets a future import tell versions apart. */
export async function exportFeedbackJson(now: () => number = Date.now): Promise<string> {
  const payload: FeedbackExport = {
    schema: FEEDBACK_EXPORT_SCHEMA,
    exportedAt: new Date(now()).toISOString(),
    entries: await loadEntries(),
  };
  return JSON.stringify(payload, null, 2);
}
