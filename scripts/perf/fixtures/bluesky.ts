/** The Bluesky generator: feed items in the shape of tests/fixtures/bluesky/html/feed.html. */
import { FAKE_FIRST_NAMES } from "../../../src/core/snapshot/fakeNames.ts";
import type { Random } from "./kit.ts";
import { pick, sentences } from "./kit.ts";

export function blueskyPost(random: Random, index: number): string {
  const declared: boolean = index % 20 === 5;
  const handle = `${pick(random, FAKE_FIRST_NAMES)}${index}.bsky.social`;
  const profileLink = (inner: string): string => `<a href="/profile/${handle}">${inner}</a>`;
  return [
    `<div data-testid="feedItem-by-${handle}"><div class="post-header">`,
    profileLink(
      declared
        ? `<div data-testid="userAvatarFallback"><svg viewBox="0 0 24 24"></svg></div>`
        : `<img data-testid="userAvatarImage" src="https://cdn.example/avatar/${index}.jpg" alt="" />`,
    ),
    `<div class="author-row">`,
    profileLink(
      `<span>Poster ${index}</span>${declared ? `<span data-testid="botBadge" aria-label="Bot account"></span>` : ""}`,
    ),
    profileLink(`<span>@${handle}</span>`),
    `<span>&middot; 2h</span></div></div>`,
    `<div class="post-body">${pick(random, sentences)}</div></div>`,
  ].join("");
}
