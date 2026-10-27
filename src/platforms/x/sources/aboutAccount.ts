/**
 * Tier 2 for X: the on-demand `AboutAccountQuery` lookup behind the "About this account" dialog
 * (country, username-change count, app store). It is the only request Botdar adds to the user's
 * X session, so it runs only through the pipeline's cache and rate limiter, and only while the
 * policy switch `tiers.t2` (narrowed by conservative mode) is on: the pipeline never calls
 * `resolve` otherwise, and the source checks again itself.
 *
 * Schema uncertainty (docs/architecture.md, day-one validation 1): X may require an
 * `x-client-transaction-id` header on this endpoint. If a plain content-script request is refused,
 * active lookups ship policy-off and Tier 2 falls back to the passive capture of the same response
 * when the user opens the dialog. A 404 means the query id rotated, not that the account is gone.
 */
import { RateLimitedError, retryAfterMsFrom } from "@/src/core/ratelimit";
import type { PartialSignals, SignalSource } from "@/src/core/types";
import { ABOUT_ACCOUNT_OPERATION } from "../graphqlRoutes";
import type { ParsedAboutAccount } from "../parsers/graphqlUsers";
import { parseAboutAccount, toAboutSignals } from "../parsers/graphqlUsers";
import type { QueryIdRegistry } from "../queryIds";

export const ABOUT_ACCOUNT_SOURCE_ID = "x.aboutAccount";

/** The bearer token X's own web client ships in its bundle; it is public and the same for everyone. */
export const X_WEB_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const CSRF_COOKIE_NAME = "ct0";
const DEFAULT_ORIGIN = "https://x.com";
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_NOT_FOUND = 404;

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface AboutAccountSourceOptions {
  registry: QueryIdRegistry;
  fetch?: FetchFn;
  readCsrfToken?: () => string | undefined;
  origin?: string;
}

export function readCookie(cookieHeader: string, name: string): string | undefined {
  for (const pair of cookieHeader.split(";")) {
    const [key, ...rest] = pair.split("=");
    if (key?.trim() === name) {
      return rest.join("=").trim() || undefined;
    }
  }
  return undefined;
}

function aboutAccountUrl(origin: string, queryId: string, handle: string): string {
  const variables: string = encodeURIComponent(JSON.stringify({ screenName: handle }));
  return `${origin}/i/api/graphql/${queryId}/${ABOUT_ACCOUNT_OPERATION}?variables=${variables}`;
}

export function createAboutAccountSource(options: AboutAccountSourceOptions): SignalSource {
  const origin: string = options.origin ?? DEFAULT_ORIGIN;
  const doFetch: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const readCsrfToken: () => string | undefined =
    options.readCsrfToken ?? (() => readCookie(document.cookie, CSRF_COOKIE_NAME));

  return {
    id: ABOUT_ACCOUNT_SOURCE_ID,
    platform: "x",
    tier: 2,
    kind: "active",
    resolve: async (ref, context): Promise<PartialSignals | null> => {
      if (!context.config.tiers.t2) {
        return null;
      }
      const queryId: string | undefined = options.registry.resolve(
        ABOUT_ACCOUNT_OPERATION,
        context.config.aboutAccountQueryId,
      );
      const csrfToken: string | undefined = readCsrfToken();
      if (queryId === undefined || csrfToken === undefined) {
        return null;
      }
      const response: Response = await doFetch(aboutAccountUrl(origin, queryId, ref.handle), {
        method: "GET",
        credentials: "include",
        signal: context.signal,
        headers: {
          authorization: `Bearer ${X_WEB_BEARER_TOKEN}`,
          "x-csrf-token": csrfToken,
          "x-twitter-active-user": "yes",
          "x-twitter-auth-type": "OAuth2Session",
          "content-type": "application/json",
          // English country names so the locale check in features.ts compares like with like.
          "accept-language": "en-US,en;q=0.9",
        },
      });
      if (response.status === HTTP_TOO_MANY_REQUESTS) {
        throw new RateLimitedError(
          "X rate-limited AboutAccountQuery",
          retryAfterMsFrom(response.headers),
        );
      }
      if (response.status === HTTP_NOT_FOUND) {
        options.registry.markStale(ABOUT_ACCOUNT_OPERATION, queryId);
        return null;
      }
      if (!response.ok) {
        return null;
      }
      const parsed: ParsedAboutAccount | null = parseAboutAccount(await response.json());
      return parsed === null || parsed.handle !== ref.handle ? null : toAboutSignals(parsed);
    },
  };
}
