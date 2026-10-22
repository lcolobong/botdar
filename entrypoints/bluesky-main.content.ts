import { installXrpcInterceptor } from "../src/platforms/bluesky/interceptor.main";

// MAIN world at document_start so the patch lands before the web app's first XRPC call (ADR-0011).
export default defineContentScript({
  matches: ["https://bsky.app/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    installXrpcInterceptor();
  },
});
