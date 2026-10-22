import { readFileSync } from "node:fs";
import { trustedKeys } from "../../../src/core/policy/publicKey.ts";
import { validatePolicy } from "../../../src/core/policy/schema.ts";
import type { Policy } from "../../../src/core/policy/schema.ts";
import { parseEnvelope, verifyEnvelope } from "../../../src/core/policy/verify.ts";
import type { SignedPolicyEnvelope } from "../../../src/core/policy/verify.ts";

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

describe("committed policy files", () => {
  it("policy/src/v1.json validates", () => {
    const policy: Policy = validatePolicy(readJson("../../../policy/src/v1.json"));
    expect(policy.version).toBeGreaterThanOrEqual(1);
  });

  it("policy/dist/v1.json verifies against the baked keys and carries the source version", async () => {
    const envelope: SignedPolicyEnvelope = parseEnvelope(readJson("../../../policy/dist/v1.json"));
    const payload: string = await verifyEnvelope(envelope, trustedKeys);
    const signed: Policy = validatePolicy(JSON.parse(payload));
    const source: Policy = validatePolicy(readJson("../../../policy/src/v1.json"));
    expect(signed).toEqual(source);
  });

  it("the baked keys hold no placeholder", () => {
    expect(Object.keys(trustedKeys)).not.toContain("placeholder");
  });
});
