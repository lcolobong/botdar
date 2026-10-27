/**
 * Tier 2 for Hacker News: the public Firebase API's `GET /v0/user/<id>.json`, made once per author
 * when a story or comment by them comes near the viewport (ADR-0020) and again on hover,
 * through the pipeline's cache, queue and rate limiter. The API needs no login and sends an
 * `access-control-allow-origin` that admits the page's origin, so the content script fetches it
 * directly and without credentials; no host permission is involved (ADR-0013). Its documentation
 * says there is no rate limit, and the shared limiter still applies.
 */
import { RateLimitedError, retryAfterMsFrom } from "../../../core/ratelimit";
import type { AccountRef, PartialSignals, ResolveContext, SignalSource } from "../../../core/types";
import type { FirebaseUserParseResult } from "../parsers/user";
import { parseFirebaseUser } from "../parsers/user";

export const FIREBASE_USER_SOURCE_ID = "hackernews.firebaseUser";
export const FIREBASE_API_ORIGIN = "https://hacker-news.firebaseio.com";
/** A prolific account's `submitted` list runs to tens of thousands of ids; this is far above that. */
const MAX_BODY_CHARS = 4 * 1024 * 1024;
const HTTP_TOO_MANY_REQUESTS = 429;

export interface FirebaseUserSourceOptions {
  fetch?: typeof fetch;
}

export function firebaseUserUrl(handle: string): string {
  return `${FIREBASE_API_ORIGIN}/v0/user/${encodeURIComponent(handle)}.json`;
}

export function createFirebaseUserSource(options: FirebaseUserSourceOptions = {}): SignalSource {
  const fetchResponse: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  const resolve = async (
    ref: AccountRef,
    context: ResolveContext,
  ): Promise<PartialSignals | null> => {
    let response: Response;
    try {
      response = await fetchResponse(firebaseUserUrl(ref.handle), {
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal: context.signal,
      });
    } catch {
      // Aborted or offline: nothing to cache, the next hover tries again.
      return null;
    }
    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      throw new RateLimitedError(
        "Firebase rate-limited user lookups",
        retryAfterMsFrom(response.headers),
      );
    }
    if (!response.ok) return null;
    let body: string;
    try {
      body = await response.text();
    } catch {
      return null;
    }
    if (body.length > MAX_BODY_CHARS) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    const result: FirebaseUserParseResult = parseFirebaseUser(parsed);
    switch (result.status) {
      case "ok":
        return result.id === ref.handle ? result.signals : null;
      case "missing":
        // An empty partial is cached as a stub so an id with no account is not asked for again.
        return {};
      case "unavailable":
        return null;
    }
  };

  return {
    id: FIREBASE_USER_SOURCE_ID,
    platform: "hackernews",
    tier: 2,
    kind: "active",
    resolve,
  };
}

export const firebaseUserSource: SignalSource = createFirebaseUserSource();
