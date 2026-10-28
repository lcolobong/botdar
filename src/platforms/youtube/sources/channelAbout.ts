/**
 * Tier 2 for YouTube: a commenter's channel About panel, through the page's own innertube API
 * (ADR-0030), when someone hovers the commenter's badge. Two same-origin requests, the ones the web
 * app itself makes when it opens a channel's About address: `navigation/resolve_url` turns the
 * handle into the channel id and the About tab's params, then `browse` returns the About panel.
 *
 * The content script runs on www.youtube.com, so both are same-origin. They go out without cookies,
 * so YouTube cannot tie the lookup to the viewer's account and a viewer without a consent cookie gets
 * the same answer, and with `hl: "en"` in the request context, so the panel's texts are English
 * whatever the viewer's language. The API needs no key; the request context names the web client
 * and the version the page itself runs, read from its `ytcfg.set(...)` script, which the isolated
 * world can read as text. Caching, the queue and the rate limiter are the pipeline's job.
 */
import { RateLimitedError, retryAfterMsFrom } from "../../../core/ratelimit";
import type { AccountRef, PartialSignals, ResolveContext, SignalSource } from "../../../core/types";
import type { ChannelAboutParseResult, ChannelEndpoint } from "../parsers/channelAbout";
import { parseChannelAbout, parseResolveUrl } from "../parsers/channelAbout";
import { YOUTUBE_ORIGIN } from "../conventions";

export const CHANNEL_ABOUT_SOURCE_ID = "youtube.channelAbout";
const RESOLVE_URL_PATH = "/youtubei/v1/navigation/resolve_url?prettyPrint=false";
const BROWSE_PATH = "/youtubei/v1/browse?prettyPrint=false";
const CLIENT_NAME = "WEB";
const CLIENT_LANGUAGE = "en";
/**
 * The version the recording ran (2026-10-27), sent only when the page's own cannot be read. The
 * page's is preferred so the request names the client the viewer is actually running.
 */
export const FALLBACK_CLIENT_VERSION = "2.20261027.01.00";
const CLIENT_VERSION_PATTERN = /"INNERTUBE_CLIENT_VERSION":"([\d.]{1,32})"/;
/** A large channel's About browse carries its home tab too: about 1.9 MB for BBC News. */
const MAX_BODY_CHARS = 4 * 1024 * 1024;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;

export interface ChannelAboutSourceOptions {
  fetch?: typeof fetch;
  /** The web client version the page runs; read from its scripts by default. */
  clientVersion?: () => string | undefined;
}

/** The version in the page's `ytcfg.set({...})` script, or undefined off YouTube. */
export function pageClientVersion(doc: Document = document): string | undefined {
  for (const script of doc.scripts) {
    const version: string | undefined = CLIENT_VERSION_PATTERN.exec(script.textContent ?? "")?.[1];
    if (version !== undefined) return version;
  }
  return undefined;
}

/** The channel's About address, which `resolve_url` maps to its id and the About tab. */
export function aboutAddressOf(handle: string): string {
  return `${YOUTUBE_ORIGIN}/@${encodeURIComponent(handle)}/about`;
}

type InnertubeAnswer = { status: "ok"; body: unknown } | { status: "notFound" | "failed" };

export function createChannelAboutSource(options: ChannelAboutSourceOptions = {}): SignalSource {
  const fetchResponse: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const clientVersion: () => string | undefined = options.clientVersion ?? pageClientVersion;
  // Only a version read from the page is kept; while none has been, every lookup reads again, since
  // the page may not have run its ytcfg script yet.
  let pageVersion: string | undefined;

  const post = async (
    path: string,
    request: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<InnertubeAnswer> => {
    pageVersion ??= clientVersion();
    const context = {
      client: {
        clientName: CLIENT_NAME,
        clientVersion: pageVersion ?? FALLBACK_CLIENT_VERSION,
        hl: CLIENT_LANGUAGE,
      },
    };
    let response: Response;
    try {
      response = await fetchResponse(`${YOUTUBE_ORIGIN}${path}`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, ...request }),
        signal,
      });
    } catch {
      // Aborted or offline: nothing to cache, the next hover tries again.
      return { status: "failed" };
    }
    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      throw new RateLimitedError(
        "YouTube rate-limited channel lookups",
        retryAfterMsFrom(response.headers),
      );
    }
    if (response.status === HTTP_NOT_FOUND) return { status: "notFound" };
    if (!response.ok) return { status: "failed" };
    try {
      const text: string = await response.text();
      return text.length > MAX_BODY_CHARS
        ? { status: "failed" }
        : { status: "ok", body: JSON.parse(text) };
    } catch {
      return { status: "failed" };
    }
  };

  const resolve = async (
    ref: AccountRef,
    context: ResolveContext,
  ): Promise<PartialSignals | null> => {
    const resolved: InnertubeAnswer = await post(
      RESOLVE_URL_PATH,
      { url: aboutAddressOf(ref.handle) },
      context.signal,
    );
    // A handle no channel answers to is cached as an empty stub so it is not asked for again.
    if (resolved.status === "notFound") return {};
    if (resolved.status !== "ok") return null;
    const channel: ChannelEndpoint | undefined = parseResolveUrl(resolved.body);
    if (channel === undefined) return null;
    const browsed: InnertubeAnswer = await post(
      BROWSE_PATH,
      { browseId: channel.browseId, params: channel.params },
      context.signal,
    );
    if (browsed.status !== "ok") return null;
    const about: ChannelAboutParseResult = parseChannelAbout(browsed.body);
    return about.status === "ok" && about.channelId === channel.browseId ? about.signals : null;
  };

  return {
    id: CHANNEL_ABOUT_SOURCE_ID,
    platform: "youtube",
    tier: 2,
    kind: "active",
    resolve,
  };
}

export const channelAboutSource: SignalSource = createChannelAboutSource();
