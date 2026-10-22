# ADR-0019: Analyse posts near the viewport, not on discovery

Status: Accepted · Date: 2026-10-22

## Context

The performance baseline (docs/performance.md) found that every post in the document was extracted
and scored in one idle-callback pass, whatever its distance from the viewport. On a 1,500-comment
Reddit thread at 4x CPU throttling that pass was one ~94 ms long task, and the cost of the first pass
grew with the size of the loaded feed rather than with what the reader can see. The product target
is "next to no impact; badges lazy-load as analysis finishes".

## Decision

The feed observers keep discovering every post, but a post is extracted, scored and badged only once
an IntersectionObserver reports it within one viewport height of the visible area
(`src/core/nearViewport.ts`, root margin `100% 0px`). The analysis then runs in idle slices capped at
8 ms (`src/core/idleSlices.ts`). An element with no layout box is analysed at once, and without
IntersectionObserver every post counts as near, so a page the gate cannot measure behaves as before.

## Consequences

- The first pass costs what is on screen plus a screen either side; the rest of the feed is analysed
  as the reader scrolls towards it, so a badge is normally in place before its post scrolls in.
- Account-level evidence now accrues as posts come near. Tier 0 signals are merged per account
  (newer wins within a tier), so when two posts by the same account render different author rows
  (one with an avatar, one without), the verdict can change when the second post comes near, and an
  earlier post by that account gains or loses its badge at that moment. Before, every post on the
  page had been merged before the first badge was drawn. Live sites render the same author row on
  every post by an account, so this should be rare; the perf comment-thread fixture shows it for one
  account.
- Tier 1 data for accounts not analysed yet still merges into the resolver as it arrives and is
  scored when the post comes near; the 2,000-account cap is unchanged.
- The benchmark's "badges at settle" count now reflects the area near the viewport, not the whole
  page; coverage after scrolling is checked separately.

## Alternatives considered

- Keep scoring everything on discovery, only sliced: removes the long task but keeps the first pass
  proportional to the page, and a live thread can hold thousands of comments.
- Analyse only posts strictly inside the viewport: badges would visibly pop in as posts scroll in.
- Defer only the badge mount and keep scoring eager: extraction and scoring were most of the cost.
