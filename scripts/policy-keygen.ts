/**
 * Generates a P-256 policy signing keypair. The private key goes to stdout ONLY, for the maintainer
 * to paste into a password manager; the public JWK is written into src/core/policy/publicKey.ts
 * under a new kid (default: the current YYYY-MM, or --kid <id>). See docs/policy-ops.md.
 */
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { trustedKeys } from "../src/core/policy/publicKey.ts";

const PLACEHOLDER_KID = "placeholder";
const KID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const publicKeyFile: URL = new URL("../src/core/policy/publicKey.ts", import.meta.url);

function readKidArgument(argv: readonly string[]): string {
  const flagIndex: number = argv.indexOf("--kid");
  if (flagIndex === -1) {
    const now: Date = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const kid: string | undefined = argv[flagIndex + 1];
  if (kid === undefined || !KID_PATTERN.test(kid)) {
    throw new Error("--kid expects an id made of letters, digits, '-' or '_'");
  }
  return kid;
}

function renderPublicKeyModule(keys: Record<string, JsonWebKey>): string {
  const entries: string = Object.entries(keys)
    .map(([kid, jwk]: [string, JsonWebKey]): string => {
      const key: string = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(kid) ? kid : JSON.stringify(kid);
      return [
        `  ${key}: {`,
        `    kty: ${JSON.stringify(jwk.kty)},`,
        `    crv: ${JSON.stringify(jwk.crv)},`,
        `    x: ${JSON.stringify(jwk.x)},`,
        `    y: ${JSON.stringify(jwk.y)},`,
        "  },",
      ].join("\n");
    })
    .join("\n");
  return `/**
 * Public halves of the policy signing keys, keyed by kid (ADR-0009). Managed by
 * scripts/policy-keygen.ts, which adds a new kid and drops the placeholder; the private halves live
 * in the maintainer's password manager and nowhere in this repository. Rotation keeps the previous
 * kid for one release so a policy signed before the rotation still verifies.
 */
export const trustedKeys: Record<string, JsonWebKey> = {
${entries}
};
`;
}

const kid: string = readKidArgument(process.argv.slice(2));
if (Object.hasOwn(trustedKeys, kid)) {
  throw new Error(`kid ${kid} already exists in publicKey.ts; pass --kid with a new id`);
}

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const { kty, crv, x, y } = publicKey.export({ format: "jwk" });
if (kty !== "EC" || crv !== "P-256" || x === undefined || y === undefined) {
  throw new Error("expected an EC P-256 public key export");
}
const keys: Record<string, JsonWebKey> = Object.fromEntries(
  Object.entries(trustedKeys).filter(([existingKid]: [string, JsonWebKey]) => {
    return existingKid !== PLACEHOLDER_KID;
  }),
);
keys[kid] = { kty, crv, x, y };
writeFileSync(publicKeyFile, renderPublicKeyModule(keys));

process.stderr.write(`Wrote public key ${kid} to src/core/policy/publicKey.ts.\n`);
process.stderr.write(
  "Private key follows on stdout. Store it in the password manager; do not save it in the repo.\n",
);
process.stdout.write(privateKey.export({ type: "pkcs8", format: "pem" }).toString());
