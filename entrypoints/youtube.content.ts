import tokensCss from "../src/ui/tokens.css?inline";
import badgeCss from "../src/ui/badge.css?inline";
import cardCss from "../src/ui/card.css?inline";
import { shadowStyles } from "../src/ui/mount";
import { registerDiagnosticsHandlers } from "../src/core/diagnosticsHandlers.ts";
import { youTubeOnHover } from "../src/platforms/youtube/adapter.ts";
import { wireOnSight } from "../src/platforms/onSightWire.ts";

export default defineContentScript({
  // Every YouTube page: the app navigates in place, so a watch page reached from the home page
  // never loads a document of its own for a narrower match to inject into.
  matches: ["https://www.youtube.com/*"],
  // "manual" keeps the stylesheets inside the bundle (imported with `?inline`); "ui" would fetch
  // them at runtime and list them under web_accessible_resources, which ADR-0013 forbids.
  cssInjectionMode: "manual",
  runAt: "document_idle",
  async main(ctx) {
    ctx.onInvalidated(registerDiagnosticsHandlers("youtube"));
    await wireOnSight(ctx, shadowStyles(tokensCss, badgeCss, cardCss), youTubeOnHover);
  },
});
