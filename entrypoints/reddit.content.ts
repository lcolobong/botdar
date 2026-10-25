import tokensCss from "../src/ui/tokens.css?inline";
import badgeCss from "../src/ui/badge.css?inline";
import cardCss from "../src/ui/card.css?inline";
import { shadowStyles } from "../src/ui/mount";
import { registerDiagnosticsHandlers } from "../src/core/diagnosticsHandlers.ts";
import { wireReddit } from "../src/platforms/reddit/wire.ts";

export default defineContentScript({
  matches: ["https://www.reddit.com/*", "https://old.reddit.com/*"],
  // "manual" keeps the stylesheets inside the bundle (imported with `?inline`); "ui" would fetch
  // them at runtime and list them under web_accessible_resources, which ADR-0013 forbids.
  cssInjectionMode: "manual",
  runAt: "document_idle",
  async main(ctx) {
    ctx.onInvalidated(registerDiagnosticsHandlers("reddit"));
    await wireReddit(ctx, shadowStyles(tokensCss, badgeCss, cardCss));
  },
});
