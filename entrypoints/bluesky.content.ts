import tokensCss from "../src/ui/tokens.css?inline";
import badgeCss from "../src/ui/badge.css?inline";
import cardCss from "../src/ui/card.css?inline";
import { shadowStyles } from "../src/ui/mount";
import { wireBluesky } from "../src/platforms/bluesky/wire";

// "manual" keeps the three stylesheets inside the bundle (imported with `?inline`) and hands them to
// the shadow roots the badge and the card mount into, so nothing of Botdar's styling reaches the
// page itself; "ui" would fetch them at runtime and list them under web_accessible_resources,
// which ADR-0013 forbids.
export default defineContentScript({
  matches: ["https://bsky.app/*"],
  runAt: "document_idle",
  cssInjectionMode: "manual",
  async main(ctx) {
    const stop: () => void = await wireBluesky(ctx, shadowStyles(tokensCss, badgeCss, cardCss));
    ctx.onInvalidated(stop);
  },
});
