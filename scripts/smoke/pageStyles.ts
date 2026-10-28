import type { SmokePlatformId } from "./sceneTable.ts";

/**
 * A recording keeps no stylesheet (scripts/capture drops them), so a served Hacker News page would
 * render in browser defaults at twice the site's type size. This approximates news.css closely
 * enough for a capture to show the badge at the size it has on the site.
 */
export const recordedPageStyles: Partial<Record<SmokePlatformId, string>> = {
  hackernews: [
    "body, td, input, textarea { font-family: Verdana, Geneva, sans-serif; font-size: 10pt; color: #828282; }",
    "#hnmain { background-color: #f6f6ef; width: 100%; }",
    "a { color: #000; text-decoration: none; }",
    ".pagetop, .pagetop a { color: #000; } .subtext, .subline, .subtext a { font-size: 7pt; color: #828282; }",
    ".comhead, .comhead a { font-size: 8pt; color: #828282; } .commtext { font-size: 9pt; color: #000; }",
    ".titleline { font-size: 10pt; } .rank { color: #828282; } .votearrow { width: 10px; height: 10px; }",
  ].join("\n"),
  // YouTube's page is mostly the player and the app's chrome; the capture keeps the creator's line
  // and the comments, in the site's type and avatar sizes.
  youtube: [
    "body { margin: 0; padding: 12px 16px; font: 14px Roboto, Arial, sans-serif; color: #0f0f0f; background: #fff; }",
    "html[dark] body { color: #f1f1f1; background: #0f0f0f; } a { color: inherit; text-decoration: none; }",
    "[hidden], ytd-masthead, #masthead-container, tp-yt-app-drawer, ytd-mini-guide-renderer, #player, #secondary,",
    "#title, #description, #actions, #subscribe-button, #action-buttons, #action-menu, ytd-comments-header-renderer,",
    "ytd-info-panel-content-renderer, tp-yt-paper-tooltip, #attributed-channel-name, #author-thumbnail img, #owner img,",
    "ytd-comment-simplebox-renderer, #expander > tp-yt-paper-button, ytd-continuation-item-renderer, #more-replies,",
    "#less-replies, ytd-button-renderer, ytd-popup-container, svg { display: none !important; }",
    "#owner { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-weight: 500; }",
    "#owner #avatar, #author-thumbnail-button { display: block; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; background: #d9d9d9; }",
    "#owner-sub-count { color: #606060; font-size: 12px; }",
    "#body { display: flex; gap: 12px; margin: 0 0 16px; } #author-thumbnail { flex: none; }",
    "#header-author { display: flex; align-items: center; gap: 4px; } #header-author h3 { margin: 0; font-size: 13px; font-weight: 500; }",
    "#published-time-text { color: #606060; font-size: 12px; } #content-text { display: block; margin-top: 2px; line-height: 20px; }",
    "ytd-comment-replies-renderer { display: block; margin-left: 56px; }",
  ].join("\n"),
};
