import { installInterceptor } from "../src/platforms/x/interceptor.main.ts";

// MAIN world at document_start so the patch lands before X's first GraphQL request
// (docs/architecture.md, day-one validation 6).
export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    installInterceptor();
  },
});
