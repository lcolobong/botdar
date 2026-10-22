/**
 * Tier 2 for Bluesky: `app.bsky.actor.getProfiles` on the public AppView, which needs no auth and
 * answers with CORS `*`. Lookups that arrive within one short window share a single request so a
 * burst of hovers or eager lookups costs one call, never one per account. Rate limiting and caching
 * stay the pipeline's job; this source only reports a 429 so the limiter can back off, and reports
 * it once per batch rather than once per account so one answer climbs the ladder one rung.
 */
import { RateLimitedError } from "../../../core/ratelimit";
import type { AccountRef, PartialSignals, ResolveContext, SignalSource } from "../../../core/types";
import { parseProfiles } from "../parsers/profiles";
import type { ParsedBlueskyProfile } from "../parsers/profiles";

export const GET_PROFILES_SOURCE_ID = "bluesky.getProfiles";
export const GET_PROFILES_ENDPOINT = "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles";
/** The lexicon's cap; the AppView answers 400 above it. */
export const MAX_ACTORS_PER_REQUEST = 25;
export const BATCH_WINDOW_MS = 150;

const HTTP_TOO_MANY_REQUESTS = 429;
/** What the other waiters of a rate-limited batch see: a missing source, not another backoff report. */
const BATCH_RATE_LIMITED_MESSAGE = "batched lookup rate limited";
const MILLISECONDS_PER_SECOND = 1000;

export interface GetProfilesSourceOptions {
  fetch?: typeof globalThis.fetch;
  batchWindowMs?: number;
  endpoint?: string;
}

interface Waiter {
  ref: AccountRef;
  signal: AbortSignal;
  resolve: (signals: PartialSignals | null) => void;
  reject: (error: unknown) => void;
}

/** Seconds or an HTTP date; undefined when absent or unreadable so the limiter uses its ladder. */
function retryAfterMsOf(response: Response): number | undefined {
  const header: string | null = response.headers.get("retry-after");
  if (header === null) {
    return undefined;
  }
  const seconds: number = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * MILLISECONDS_PER_SECOND;
  }
  const at: number = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Lookup aborted", "AbortError");
}

/**
 * Every waiter is its own pipeline lookup and would report a RateLimitedError on its own, so a 429
 * that answers the whole batch reaches only the first live waiter as RateLimitedError; the rest
 * fail with a plain error the pipeline treats as a missing source. Aborted waiters keep their
 * abort reason.
 */
function rejectBatch(live: Waiter[], error: unknown): void {
  let rateLimitReported = false;
  for (const waiter of live) {
    if (waiter.signal.aborted) {
      waiter.reject(abortError(waiter.signal));
    } else if (error instanceof RateLimitedError && rateLimitReported) {
      waiter.reject(new Error(BATCH_RATE_LIMITED_MESSAGE));
    } else {
      rateLimitReported ||= error instanceof RateLimitedError;
      waiter.reject(error);
    }
  }
}

function profileFor(ref: AccountRef, profiles: ParsedBlueskyProfile[]): PartialSignals | null {
  const match: ParsedBlueskyProfile | undefined = profiles.find(
    (profile) =>
      profile.ref.handle === ref.handle || (ref.id !== undefined && profile.ref.id === ref.id),
  );
  return match?.signals ?? null;
}

export function createGetProfilesSource(options: GetProfilesSourceOptions = {}): SignalSource {
  const fetchFn: typeof globalThis.fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const batchWindowMs: number = options.batchWindowMs ?? BATCH_WINDOW_MS;
  const endpoint: string = options.endpoint ?? GET_PROFILES_ENDPOINT;
  let pending: Waiter[] = [];
  let windowTimer: ReturnType<typeof setTimeout> | undefined;

  const sendBatch = async (waiters: Waiter[]): Promise<void> => {
    const live: Waiter[] = waiters.filter((waiter) => !waiter.signal.aborted);
    if (live.length === 0) {
      return;
    }
    // The request is abandoned only once every account it serves has been abandoned.
    const controller = new AbortController();
    let abandoned = 0;
    for (const waiter of live) {
      waiter.signal.addEventListener("abort", () => {
        abandoned += 1;
        if (abandoned === live.length) {
          controller.abort();
        }
      });
    }
    const url = new URL(endpoint);
    for (const handle of new Set(live.map((waiter) => waiter.ref.handle))) {
      url.searchParams.append("actors", handle);
    }
    try {
      // No credentials: this is a sanctioned anonymous read, so the user's session is never involved.
      const response: Response = await fetchFn(url, {
        signal: controller.signal,
        credentials: "omit",
        headers: { accept: "application/json" },
      });
      if (response.status === HTTP_TOO_MANY_REQUESTS) {
        throw new RateLimitedError("getProfiles rate limited", retryAfterMsOf(response));
      }
      if (!response.ok) {
        throw new Error(`getProfiles http ${response.status}`);
      }
      const profiles: ParsedBlueskyProfile[] = parseProfiles(await response.json());
      for (const waiter of live) {
        waiter.resolve(profileFor(waiter.ref, profiles));
      }
    } catch (error) {
      rejectBatch(live, error);
    }
  };

  const flush = (): void => {
    windowTimer = undefined;
    while (pending.length > 0) {
      void sendBatch(pending.splice(0, MAX_ACTORS_PER_REQUEST));
    }
  };

  const resolve = (ref: AccountRef, context: ResolveContext): Promise<PartialSignals | null> =>
    new Promise<PartialSignals | null>((resolveWaiter, rejectWaiter) => {
      if (context.signal.aborted) {
        rejectWaiter(abortError(context.signal));
        return;
      }
      const waiter: Waiter = {
        ref,
        signal: context.signal,
        resolve: resolveWaiter,
        reject: rejectWaiter,
      };
      context.signal.addEventListener("abort", () => {
        pending = pending.filter((candidate) => candidate !== waiter);
        rejectWaiter(abortError(context.signal));
      });
      pending.push(waiter);
      if (windowTimer === undefined) {
        windowTimer = setTimeout(flush, batchWindowMs);
      }
    });

  return {
    id: GET_PROFILES_SOURCE_ID,
    platform: "bluesky",
    tier: 2,
    kind: "active",
    resolve,
  };
}
