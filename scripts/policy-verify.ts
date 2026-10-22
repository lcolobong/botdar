/**
 * Verifies policy/dist/v1.json against the baked public keys through the extension's own verify.ts
 * and validator. The Pages workflow runs this before deploying and never signs, so a tampered or
 * unsigned dist cannot be published. Exits non-zero on any failure. See docs/policy-ops.md.
 */
import { readFileSync } from "node:fs";
import { trustedKeys } from "../src/core/policy/publicKey.ts";
import { validatePolicy } from "../src/core/policy/schema.ts";
import type { Policy } from "../src/core/policy/schema.ts";
import { parseEnvelope, verifyEnvelope } from "../src/core/policy/verify.ts";
import type { SignedPolicyEnvelope } from "../src/core/policy/verify.ts";

const distFile: URL = new URL("../policy/dist/v1.json", import.meta.url);

try {
  const envelope: SignedPolicyEnvelope = parseEnvelope(JSON.parse(readFileSync(distFile, "utf8")));
  const payload: string = await verifyEnvelope(envelope, trustedKeys);
  const policy: Policy = validatePolicy(JSON.parse(payload));
  process.stdout.write(
    `policy/dist/v1.json: version ${policy.version}, kid ${envelope.kid}, issued ${policy.issuedAt}: ok\n`,
  );
} catch (error) {
  const detail: string = error instanceof Error ? error.message : String(error);
  process.stderr.write(`policy/dist/v1.json: FAILED: ${detail}\n`);
  process.exit(1);
}
