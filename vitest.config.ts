import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    globals: true,
    environment: "node",
    // Without this vitest stubs every CSS module, including `tokens.css?raw`, with an empty string.
    css: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup/intersectionObserver.ts"],
  },
});
