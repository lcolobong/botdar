import tokensCss from "../src/ui/tokens.css?inline";
import badgeCss from "../src/ui/badge.css?inline";
import cardCss from "../src/ui/card.css?inline";
import { shadowStyles } from "../src/ui/mount";
import { registerDiagnosticsHandlers } from "../src/core/diagnosticsHandlers.ts";
import { hackerNewsOnSight } from "../src/platforms/hackernews/adapter.ts";
import { wireOnSight } from "../src/platforms/onSightWire.ts";

export default defineContentScript({
  matches: ["https://news.ycombinator.com/*"],
  // "manual" keeps the stylesheets inside the bundle (imported with `?inline`); "ui" would fetch
  // them at runtime and list them under web_accessible_resources, which ADR-0013 forbids.
  cssInjectionMode: "manual",
  runAt: "document_idle",
  async main(ctx) {
    ctx.onInvalidated(registerDiagnosticsHandlers("hackernews"));
    await wireOnSight(ctx, shadowStyles(tokensCss, badgeCss, cardCss), hackerNewsOnSight);
  },
});
