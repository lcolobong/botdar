# ADR-0011: MAIN-world fetch/XHR interception with a guarded relay

Status: Accepted
Date: 2026-10-22

## Context

X's feed renders only name, handle, avatar, badge and timestamp per post; join date and counts appear
on the profile and hover card. But the page's own GraphQL responses (`HomeTimeline`,
`TweetDetail`, `UserByScreenName` and others) carry full author objects with `core.created_at`,
`relationship_count`, `tweet_count`, `profile_bio.description` and `is_blue_verified`. Bluesky's web
app likewise receives author objects with `createdAt` and `labels` in `getTimeline`, `getFeed` and
`getPostThread`. Reading these responses passively yields Tier 1 signals with zero extra requests.

Content scripts run in an isolated world and cannot see the page's `fetch`. Only a script in the page's
MAIN world can patch it. That script runs with the page's privileges, so it must be tiny, auditable,
and unable to break the page.

## Decision

- A separate entrypoint (`entrypoints/x-main.content.ts`, and the Bluesky equivalent) is declared with
  `world: 'MAIN'` and `runAt: 'document_start'`, patching `window.fetch` and
  `XMLHttpRequest.prototype.open/send`.
- Only requests whose URL matches `/i/api/graphql/<queryId>/<op>` with `op` in an explicit allowlist
  (or the Bluesky XRPC equivalents) are inspected. Everything else passes through untouched.
- The original response is always returned to the page; the body is read from `response.clone()`
  asynchronously inside `try/catch`. The interceptor never throws into the page.
- The interceptor posts `{ __botdar: 1, v: 1, kind, op, queryId, body }` via `window.postMessage` to
  `location.origin`. The isolated-world receiver accepts only `event.source === window`,
  `event.origin === location.origin` and the exact envelope shape, caps body size at 5 MB, and treats
  every payload as untrusted data walked with type guards.
- All parsing lives in the isolated world (`src/platforms/x/parsers/graphqlUsers.ts`), so the
  MAIN-world bundle stays under about 80 lines and the schema-walking code is unit-tested against
  recorded fixtures in one place.
- The interceptor also records `{op, queryId}` pairs so rotating query IDs can be discovered at
  runtime, with the policy file (ADR-0007) as the fallback.

## Consequences

- Rich X and Bluesky signals with no additional traffic, which is the heart of Tier 1 (ADR-0006).
- The Chrome Web Store reviewer will see a fetch patch; the listing carries a justification paragraph
  and the data-use disclosure.
- Schema rotation is a standing maintenance cost; parsers must degrade to partial signals, never throw,
  and the risk register tracks it.
- Firefox needs 128+ for manifest-registered MAIN-world scripts; the fallback is WXT's `injectScript`,
  which would require `web_accessible_resources` and conflicts with ADR-0013, so it is a last resort.

## Alternatives considered

- **DOM only.** Rejected: X in-feed verdicts would be nearly empty.
- **`webRequest` body reading.** Rejected: MV3 does not expose response bodies.
- **Script-tag injection via `web_accessible_resources`.** Rejected: exposes a fingerprintable file
  (ADR-0013).
