/**
 * Rewrites a recorded fixture with stable fake identifiers in place:
 *
 *   pnpm fixtures:anonymize -- <file> --platform x|reddit|bluesky|hackernews
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnonymizedSnapshot, SnapshotPlatform } from "../src/core/snapshot/anonymize.ts";
import { SNAPSHOT_PLATFORMS, anonymizeSnapshot } from "../src/core/snapshot/anonymize.ts";
import { flagValue } from "./smoke/run.ts";

const argv: readonly string[] = process.argv.slice(2);
const file: string | undefined = argv.find((argument) => !argument.startsWith("--"));
const platform: string | undefined = flagValue(argv, "--platform");
const isSnapshotPlatform = (value: string | undefined): value is SnapshotPlatform =>
  value !== undefined && (SNAPSHOT_PLATFORMS as readonly string[]).includes(value);
if (file === undefined || !isSnapshotPlatform(platform)) {
  process.stderr.write(
    `usage: pnpm fixtures:anonymize -- <file> --platform ${SNAPSHOT_PLATFORMS.join("|")}\n`,
  );
  process.exit(2);
}
const path: string = resolve(file);
const result: AnonymizedSnapshot = anonymizeSnapshot(readFileSync(path, "utf8"), platform);
writeFileSync(path, result.html);
process.stdout.write(
  `${path}: ${result.handles} identifiers replaced, ${result.replaced} substitutions\n`,
);
