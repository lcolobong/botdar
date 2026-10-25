/**
 * Rewrites a recorded fixture with stable fake identifiers in place:
 *
 *   pnpm fixtures:anonymize -- <file> --platform x|reddit|bluesky
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnonymizedSnapshot, SnapshotPlatform } from "../src/core/snapshot/anonymize.ts";
import { anonymizeSnapshot } from "../src/core/snapshot/anonymize.ts";
import { flagValue } from "./smoke/run.ts";

const argv: readonly string[] = process.argv.slice(2);
const file: string | undefined = argv.find((argument) => !argument.startsWith("--"));
const platform: string | undefined = flagValue(argv, "--platform");
if (file === undefined || (platform !== "x" && platform !== "reddit" && platform !== "bluesky")) {
  process.stderr.write("usage: pnpm fixtures:anonymize -- <file> --platform x|reddit|bluesky\n");
  process.exit(2);
}
const path: string = resolve(file);
const result: AnonymizedSnapshot = anonymizeSnapshot(
  readFileSync(path, "utf8"),
  platform as SnapshotPlatform,
);
writeFileSync(path, result.html);
process.stdout.write(
  `${path}: ${result.handles} identifiers replaced, ${result.replaced} substitutions\n`,
);
