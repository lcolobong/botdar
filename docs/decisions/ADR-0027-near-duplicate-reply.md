# ADR-0027: Near-duplicate replies, scored per account from a per-page thread index

Status: Accepted · Date: 2026-10-27

## Context

The adversarial-evasion pass ([adversarial-evasion.md](../adversarial-evasion.md), 4.1 and 5) ranked
`thread.nearDuplicateReply` first among the local v1.1 countermeasures: reply farms post one template
from many accounts, and making them write a reply per account costs an LLM call each and gives up
proven templates. It is the project's first `coordination` signal and the first feature that reads
other accounts' posts. The pass specified the numbers (weight 1.5; `[0,1)→0` `[1,2)→0.6` `[2,4)→1.0`
`[4,∞)→1.5`; Jaccard ≥ 0.7; text ≥ 40 characters and ≥ 6 words; the parent never a source; only
earlier replies count, so copying a real person flags the copier) and sketched a contract: thread
features attached to the `PostRef` and merged at render time, compared as character 5-gram shingles.

Facts that shaped the build, checked on 2026-10-27:

- The resolver keys every verdict by handle; each badge and the hover card show the account's read,
  and `toFeatures(signals)` is the one place features are made (`src/core/pipeline.ts`, 786 lines).
- Observers discover every post eagerly but analyse one only near the viewport (ADR-0019), so at the
  moment a reply is scored the replies around it may not have been analysed, and on Reddit a "best"
  sort can put a copy above its original.
- Each platform gives a reply a server or client time without a network call: X status ids are
  snowflakes (server time to the millisecond); Reddit's hand-written fixtures give a comment a
  `faceplate-timeago[ts]` with a colon-less offset ("+0000"), which only V8's legacy date parser
  reads; Hacker News renders `span.age[title]` in UTC; a Bluesky post's record key is a TID (microseconds), written by
  the author's client.
- Only Hacker News has a recorded thread page (`tests/fixtures/hackernews/html/thread.html`). X,
  Reddit and Bluesky threads are hand-written fixtures; their reply-text and quote selectors are
  guesses (ADR-0021).

## Decision

Ship `thread.nearDuplicateReply` on X, Reddit, Bluesky and Hacker News at the spec'd numbers, Tier 0,
in a new `coordination` group capped at 1.5 on every platform, scored per account from an in-memory
index of the current page's thread replies.

- **Value.** The number of *distinct other authors* with a reply earlier in the same thread whose word
  set has Jaccard similarity ≥ 0.7 with this account's reply; the most over the account's replies on
  the page. Distinct authors rather than replies, so one account repeating itself cannot inflate
  someone else's count. Omitted when the account has no reply on the page that clears the gate.
- **Per account, per page, not per post.** Each platform's `toFeatures` stays account-only; the
  adapter appends the count through one shared helper (`PageThreads.withPageEvidence`), not through
  `AccountSignals`, so it is never merged, cached or persisted, and it
  disappears when the page changes. On a thread page every post by the account is in that thread, so
  this gives what per-post scoring would without a second verdict path through the resolver and four
  wirings. The reason line does not name the thread; it is the one on screen.
- **Text.** NFKC, lowercase, URLs, `@mentions` (Bluesky handles with their dots, Reddit `u/` names),
  punctuation and emoji removed, whitespace collapsed; an apostrophe inside a word is dropped so a
  contraction stays one word and a line of them cannot pass the six-word gate; tokens are the
  distinct words. Words rather
  than 5-gram or word shingles: an operator's cheap edits (a swapped word, an added hashtag or emoji,
  a reordered clause) keep most words but break most shingles (one swapped word in ten drops word
  bigram Jaccard to about 0.64, word-set Jaccard stays at 0.82), and two different replies of six
  words or more rarely share 70% of their vocabulary. Digits are kept. Unspaced scripts (Chinese,
  Japanese, Thai) never clear the six-word gate, so the feature is silent there.
- **Who is a source.** Only a strictly earlier reply by another author. The root post and its
  ancestors are never recorded: on X and Bluesky a reply is a post whose id or record key is later
  than the root's the URL names; on Reddit only `shreddit-comment` elements are read; on Hacker News
  the head item is skipped. Id order is not membership on X: promoted posts among the replies and
  the posts X appends under a closing heading ("Discover more") are newer than the root too, so a
  promoted post and anything below the heading are turned away, and once the heading has been seen
  on a page a post read while it is out of the DOM (virtualised away) is treated as off the thread.
  The promoted-post wrapper and the heading are guesses until a thread is recorded. A reply's own parent (Reddit `parentid`, Hacker News "parent" link) is
  never its source, and quoted text (Reddit `blockquote`, a Hacker News paragraph opening with ">",
  the quoted-post card on X) is left out, so answering someone by quoting them is not copying them.
- **Discovery, not analysis, feeds the index.** Every observer gets an `onDiscovered` hook and hands
  over each post it finds, near the viewport or not, so a copy is compared with the whole thread the
  page holds, badged or not: the badge mark survives an in-place navigation and a reinjected script,
  while the index starts empty after both. Each element is read once to a final answer (a reply, or
  structurally not one: the root, an ancestor, no text, off the thread); only a Reddit comment whose
  body or time has not been slotted in yet is read again on a later pass. Comparisons run only when
  an account is scored, against its thread; recording costs one text read and normalisation per
  post. An account asked about before any reply of its could be compared is remembered too, so its
  comparable reply recorded later still reaches the resolver. Once an account has been scored its count is kept current:
  a reply recorded later that changes it (an earlier original lower in the page) notifies the
  resolver through `PlatformAdapter.onEvidenceChanged`, which rescores the account if it is on screen.
- **Privacy.** The index holds word sets, authors, ids and times for the current page, never the
  text, in memory only, capped at 5,000 replies; an in-place navigation clears it (X, Reddit, Bluesky)
  and Hacker News navigates by full page loads. No request is added.
- **Hacker News included.** Its thread markup is recorded and server-rendered, and the reader is about
  80 lines, so the cost was small. /newcomments, which mixes threads, is not read. old.reddit is not
  read: its comments carry no thread or parent id attributes.
- **Weights restrict-able by policy**, like every feature, pending calibration.

## Consequences

- The card gains "Reply closely matches an earlier one by another account" / "… earlier ones by
  {n} other accounts", why "reply templates get reused across accounts", and the feature's own
  counter-case "Popular phrases and memes get repeated by real people." The group caveat for
  `coordination` is "People reacting to the same post often say the same thing."
- Alone the feature cannot reach `some` (prior −2.5 + 1.5 gives p ≈ 0.27 on X and Bluesky, lower on
  Reddit and Hacker News), and as one group it can never meet the two-group rule for `many`. With a
  second group it can: a two-week-old Reddit account with two earlier copies reads Unsure where it
  read Likely human before.
- Evidence follows the account across its badges on the page: a copier's other posts on the same
  page show the same read. After an in-place navigation the evidence is gone, and the account's next
  badge is scored without it.
- **Bluesky ordering is client-written.** A TID can be backdated, so an operator could post a copy
  that sorts before a real reply and make its author look like the copier. The damage is bounded as
  above (one fake earlier copy adds 0.6, four add 1.5, still below `some` alone), and Tier 1
  `getPostThread` bodies carry the AppView's `indexedAt`, which a later change can use instead.
- Discovery now reads each post's text once. On the 1,500-comment perf fixture that is one text read
  and normalisation per comment in the first discovery pass; `pnpm perf` should be rerun to confirm
  the first pass stays within budget (docs/performance.md).
- We owe the calibration in adversarial-evasion.md 6 (fire rate on 100 threads per platform; the
  earliest author of a cluster must never fire), recordings of X, Reddit and Bluesky thread pages to
  replace the guessed selectors (X's quote card, promoted-post wrapper and closing heading; Reddit's
  comment body slot and comment time; Bluesky's `postText` and post links), and a decision on Tier 1 `indexedAt` ordering for Bluesky.

## Alternatives considered

- **Per-post thread evidence merged at render time** (the evasion pass's sketch). Truer when an
  account appears in two threads on one page, which a thread page does not show, at the cost of a
  second verdict path in the resolver, the three wirings and the card. Deferred until a page that
  mixes threads is worth scoring.
- **A Tier 0 `AccountSignals` field filled by `extractDomSignals`.** Gets provenance for free, but the
  same-tier "newer wins" merge would let a later post's lower count overwrite a higher one, and the
  value would outlive the page in the resolver's 2,000-account map. Rejected.
- **Index at analysis (near the viewport) only.** No eager text reads, but an original further down a
  "best"-sorted Reddit thread would be missed until scrolled to. Rejected for discovery-time recording
  with the rescore hook.
- **Character 5-gram shingles.** Robust to typos but more expensive per pair, language-sensitive in
  how much a shared stem counts, and harder to explain on the card. Rejected for word sets.
- **Count replies, not authors.** One prolific account repeating a line would inflate every later
  copier's count. Rejected.
