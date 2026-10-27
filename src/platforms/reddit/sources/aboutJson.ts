/**
 * Tier 2 for Reddit: a same-origin `GET /user/<name>/about.json?raw_json=1` with the user's own
 * cookies, made once per author when a post by them comes near the viewport (ADR-0020), and again
 * on hover, through the pipeline's cache, queue and rate limiter. Logged-out sessions get 403 or an
 * HTML login page; after one of those the source pauses itself, since every further lookup would
 * get the same answer and add nothing but traffic to the user's session.
 */
import type { AccountRef, PartialSignals, ResolveContext, SignalSource } from "../../../core/types";
import type { AboutParseResult } from "../parsers/about";
import { parseAboutResponse } from "../parsers/about";
import type { LoginPause, RedditJsonResult } from "./redditJson";
import {
  LOGIN_REQUIRED_PAUSE_MS,
  createLoginPause,
  fetchRedditJson,
  redditLoginPause,
} from "./redditJson";

export const ABOUT_JSON_SOURCE_ID = "reddit.aboutJson";
export { LOGIN_REQUIRED_PAUSE_MS };

export interface AboutJsonSourceOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** Shared with the other Reddit sources; a source of its own by default. */
  loginPause?: LoginPause;
}

export interface AboutJsonSource extends SignalSource {
  /** True while the source is paused after a logged-out answer. */
  loginRequired: () => boolean;
}

export function aboutJsonPath(handle: string): string {
  return `/user/${encodeURIComponent(handle)}/about.json?raw_json=1`;
}

export function createAboutJsonSource(options: AboutJsonSourceOptions = {}): AboutJsonSource {
  const fetchResponse: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now: () => number = options.now ?? Date.now;
  const loginPause: LoginPause = options.loginPause ?? createLoginPause(now);

  const resolve = async (
    ref: AccountRef,
    context: ResolveContext,
  ): Promise<PartialSignals | null> => {
    if (loginPause.active()) return null;
    const response: RedditJsonResult = await fetchRedditJson({
      fetch: fetchResponse,
      now,
      path: aboutJsonPath(ref.handle),
      signal: context.signal,
      label: "about.json",
    });
    if (response.status === "loginRequired" || response.status === "forbidden") {
      loginPause.trip();
      return null;
    }
    if (response.status !== "ok") return null;
    const result: AboutParseResult = parseAboutResponse(response.body);
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
    loginRequired: loginPause.active,
  };
}

export const aboutJsonSource: AboutJsonSource = createAboutJsonSource({
  loginPause: redditLoginPause,
});
