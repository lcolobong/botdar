/**
 * The same-origin JSON fetch every Reddit Tier 2 source makes: the user's own cookies, a JSON accept
 * header, the pipeline's abort signal, a body size cap and the rate-limit and logged-out handling
 * shared by about.json and overview.json. Reddit answers a logged-out session with 401, 403 or an
 * HTML login page (sometimes served as a 200 without its content type).
 */
import { RateLimitedError, retryAfterMsFrom } from "../../../core/ratelimit";

/** How long lookups stay off after a logged-out answer. */
export const LOGIN_REQUIRED_PAUSE_MS = 10 * 60_000;

/**
 * The pause every Reddit Tier 2 source shares: a logged-out answer to any of them means every
 * further lookup would get the same answer and add nothing but traffic to the user's session.
 */
export interface LoginPause {
  trip: () => void;
  active: () => boolean;
}

export function createLoginPause(now: () => number = Date.now): LoginPause {
  let pausedUntil = 0;
  return {
    trip: () => {
      pausedUntil = now() + LOGIN_REQUIRED_PAUSE_MS;
    },
    active: () => now() < pausedUntil,
  };
}

/** The pause of the real sources, so a login wall seen by one stops both. */
export const redditLoginPause: LoginPause = createLoginPause();

/** A real about.json is a few kilobytes and a 100-item overview a few hundred; this is far above both. */
const MAX_BODY_CHARS = 1024 * 1024;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;

export type RedditJsonResult =
  | { status: "ok"; body: unknown }
  | { status: "loginRequired" }
  /** 403: a logged-out session, or something this user's profile does not allow. */
  | { status: "forbidden" }
  | { status: "notFound" }
  | { status: "failed" };

export interface RedditJsonRequest {
  fetch: typeof fetch;
  now: () => number;
  path: string;
  signal: AbortSignal;
  /** Names the lookup in the error a 429 raises. */
  label: string;
}

function isHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}

/** Throws `RateLimitedError` on a 429; every other outcome is a result the source maps itself. */
export async function fetchRedditJson({
  fetch: fetchResponse,
  now,
  path,
  signal,
  label,
}: RedditJsonRequest): Promise<RedditJsonResult> {
  let response: Response;
  try {
    response = await fetchResponse(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch {
    // Aborted or offline: nothing to cache, the next hover tries again.
    return { status: "failed" };
  }
  if (response.status === HTTP_TOO_MANY_REQUESTS) {
    throw new RateLimitedError(
      `Reddit rate-limited ${label}`,
      retryAfterMsFrom(response.headers, now()),
    );
  }
  if (response.status === HTTP_FORBIDDEN) return { status: "forbidden" };
  if (response.status === HTTP_NOT_FOUND) return { status: "notFound" };
  if (response.status === HTTP_UNAUTHORIZED || isHtml(response)) {
    return { status: "loginRequired" };
  }
  if (!response.ok) return { status: "failed" };
  let body: string;
  try {
    body = await response.text();
  } catch {
    return { status: "failed" };
  }
  if (body.length > MAX_BODY_CHARS) return { status: "failed" };
  try {
    return { status: "ok", body: JSON.parse(body) };
  } catch {
    // A 200 that is not JSON is the login page served without its content type.
    return { status: "loginRequired" };
  }
}
