/**
 * Tier 2 for Reddit: a same-origin `GET /user/<name>/about.json?raw_json=1` with the user's own
 * cookies, made once per author when a post by them comes near the viewport (ADR-0020), and again
 * on hover, through the pipeline's cache, queue and rate limiter. Logged-out sessions get 403 or an
 * HTML login page; after one of those the source pauses itself, since every further lookup would
 * get the same answer and add nothing but traffic to the user's session.
 */
import { RateLimitedError } from "../../../core/ratelimit";
import type { AccountRef, PartialSignals, ResolveContext, SignalSource } from "../../../core/types";
import type { AboutParseResult } from "../parsers/about";
import { parseAboutResponse } from "../parsers/about";

export const ABOUT_JSON_SOURCE_ID = "reddit.aboutJson";
/** How long lookups stay off after a logged-out answer. */
export const LOGIN_REQUIRED_PAUSE_MS = 10 * 60_000;
/** A real about.json is a few kilobytes; anything near this cap is not one. */
const MAX_BODY_CHARS = 1024 * 1024;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

export interface AboutJsonSourceOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

export interface AboutJsonSource extends SignalSource {
  /** True while the source is paused after a logged-out answer. */
  loginRequired: () => boolean;
}

export function aboutJsonPath(handle: string): string {
  return `/user/${encodeURIComponent(handle)}/about.json?raw_json=1`;
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

function isHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}

export function createAboutJsonSource(options: AboutJsonSourceOptions = {}): AboutJsonSource {
  const fetchResponse: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now: () => number = options.now ?? Date.now;
  let loginRequiredUntil = 0;

  const pauseForLogin = (): void => {
    loginRequiredUntil = now() + LOGIN_REQUIRED_PAUSE_MS;
  };

  const resolve = async (
    ref: AccountRef,
    context: ResolveContext,
  ): Promise<PartialSignals | null> => {
    if (now() < loginRequiredUntil) return null;
    let response: Response;
    try {
      response = await fetchResponse(aboutJsonPath(ref.handle), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: context.signal,
      });
    } catch {
      // Aborted or offline: nothing to cache, the next hover tries again.
      return null;
    }
    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      throw new RateLimitedError("Reddit rate-limited about.json", retryAfterMs(response));
    }
    if (
      response.status === HTTP_UNAUTHORIZED ||
      response.status === HTTP_FORBIDDEN ||
      isHtml(response)
    ) {
      pauseForLogin();
      return null;
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
      // A 200 that is not JSON is the login page served without its content type.
      pauseForLogin();
      return null;
    }
    const result: AboutParseResult = parseAboutResponse(parsed);
    switch (result.status) {
      case "ok":
        return result.handle === ref.handle ? result.signals : null;
      case "suspended":
        // An empty partial is cached as a stub so a suspended account is not looked up again.
        return result.handle === ref.handle ? {} : null;
      case "unavailable":
        return null;
    }
  };

  return {
    id: ABOUT_JSON_SOURCE_ID,
    platform: "reddit",
    tier: 2,
    kind: "active",
    resolve,
    loginRequired: () => now() < loginRequiredUntil,
  };
}

export const aboutJsonSource: AboutJsonSource = createAboutJsonSource();
