/**
 * Signs policy/src/v1.json into policy/dist/v1.json. The source is validated with the extension's
 * own validator, the version must exceed the one already in dist, and the signing key comes from
 * POLICY_SIGNING_KEY (PKCS8 PEM) or --key-file <path outside the repo>. The kid is derived from
 * the key: its public half must already be baked into src/core/policy/publicKey.ts.
 * See docs/policy-ops.md.
 */
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { trustedKeys } from "../src/core/policy/publicKey.ts";
import { validatePolicy } from "../src/core/policy/schema.ts";
import type { Policy } from "../src/core/policy/schema.ts";
import { parseEnvelope } from "../src/core/policy/verify.ts";
import type { SignedPolicyEnvelope } from "../src/core/policy/verify.ts";

const sourceFile: URL = new URL("../policy/src/v1.json", import.meta.url);
const distFile: URL = new URL("../policy/dist/v1.json", import.meta.url);

function readSigningKey(argv: readonly string[]): KeyObject {
  const flagIndex: number = argv.indexOf("--key-file");
  if (flagIndex !== -1) {
    const path: string | undefined = argv[flagIndex + 1];
    if (path === undefined) throw new Error("--key-file expects a path");
    return createPrivateKey(readFileSync(path, "utf8"));
  }
  const pem: string | undefined = process.env.POLICY_SIGNING_KEY;
  if (pem === undefined || pem.trim().length === 0) {
    throw new Error("set POLICY_SIGNING_KEY to the PKCS8 PEM or pass --key-file <path>");
  }
  return createPrivateKey(pem);
}

function findKid(privateKey: KeyObject): string {
  const { x, y } = createPublicKey(privateKey).export({ format: "jwk" });
  for (const [kid, jwk] of Object.entries(trustedKeys)) {
    if (jwk.x === x && jwk.y === y) return kid;
  }
  throw new Error(
    "the signing key's public half is not in publicKey.ts; run pnpm policy:keygen first",
  );
}

function previousVersion(): number | null {
  if (!existsSync(distFile)) return null;
  const envelope: SignedPolicyEnvelope = parseEnvelope(JSON.parse(readFileSync(distFile, "utf8")));
  return validatePolicy(JSON.parse(envelope.payload)).version;
}

const policy: Policy = validatePolicy(JSON.parse(readFileSync(sourceFile, "utf8")));
const previous: number | null = previousVersion();
if (previous !== null && policy.version <= previous) {
  throw new Error(`version ${policy.version} must be greater than the signed version ${previous}`);
}

const privateKey: KeyObject = readSigningKey(process.argv.slice(2));
const kid: string = findKid(privateKey);
const payload: string = JSON.stringify(policy);
const signature: Buffer = sign("sha256", Buffer.from(payload, "utf8"), {
  key: privateKey,
  dsaEncoding: "ieee-p1363",
});
const envelope: SignedPolicyEnvelope = {
  alg: "ES256",
  kid,
  payload,
  sig: signature.toString("base64url"),
};
mkdirSync(new URL("./", distFile), { recursive: true });
writeFileSync(distFile, `${JSON.stringify(envelope, null, 2)}\n`);
process.stdout.write(
  `Signed policy version ${policy.version} with kid ${kid} into policy/dist/v1.json\n`,
);
