/**
 * ES256 verification of the signed policy envelope (ADR-0009). Runs on WebCrypto only, so the same
 * code path serves the service worker, the tests and scripts/policy-verify.ts. The payload is
 * verified as an opaque UTF-8 string and only parsed afterwards, so no JSON canonicalisation exists
 * to get wrong.
 */
export interface SignedPolicyEnvelope {
  alg: "ES256";
  /** Names the public key in publicKey.ts; rotation ships a new kid in a release. */
  kid: string;
  /** The unsigned policy JSON, exactly as signed. */
  payload: string;
  /** base64url of the raw `r || s` signature (IEEE P1363), 64 bytes for P-256. */
  sig: string;
}

export class PolicySignatureError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PolicySignatureError";
  }
}

const ENVELOPE_KEYS: readonly string[] = ["alg", "kid", "payload", "sig"];
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const P256_SIGNATURE_BYTES = 64;
const MAX_PAYLOAD_BYTES = 256 * 1024;

const ECDSA_P256: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };
const ES256: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

export function parseEnvelope(input: unknown): SignedPolicyEnvelope {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PolicySignatureError("envelope: expected an object");
  }
  const record: Record<string, unknown> = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ENVELOPE_KEYS.includes(key)) {
      throw new PolicySignatureError(`envelope.${key}: unknown key`);
    }
  }
  if (record.alg !== "ES256") throw new PolicySignatureError("envelope.alg: expected ES256");
  const { kid, payload, sig } = record;
  if (typeof kid !== "string" || kid.length === 0) {
    throw new PolicySignatureError("envelope.kid: expected a non-empty string");
  }
  if (typeof payload !== "string" || payload.length === 0) {
    throw new PolicySignatureError("envelope.payload: expected a non-empty string");
  }
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new PolicySignatureError(`envelope.payload: larger than ${MAX_PAYLOAD_BYTES} characters`);
  }
  if (typeof sig !== "string" || sig.length === 0) {
    throw new PolicySignatureError("envelope.sig: expected a non-empty string");
  }
  return { alg: "ES256", kid, payload, sig };
}

export function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!BASE64URL_PATTERN.test(text) || text.length % 4 === 1) {
    throw new PolicySignatureError("expected base64url");
  }
  const padded: string =
    text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new PolicySignatureError("expected base64url");
  }
  return Uint8Array.from(binary, (character: string) => character.charCodeAt(0));
}

/** Resolves to the verified payload string, or rejects with a PolicySignatureError. */
export async function verifyEnvelope(
  envelope: SignedPolicyEnvelope,
  trustedKeys: Record<string, JsonWebKey>,
): Promise<string> {
  const jwk: JsonWebKey | undefined = Object.hasOwn(trustedKeys, envelope.kid)
    ? trustedKeys[envelope.kid]
    : undefined;
  if (jwk === undefined) throw new PolicySignatureError(`unknown kid ${envelope.kid}`);
  const signature: Uint8Array<ArrayBuffer> = decodeBase64Url(envelope.sig);
  if (signature.length !== P256_SIGNATURE_BYTES) {
    throw new PolicySignatureError(`expected a ${P256_SIGNATURE_BYTES}-byte signature`);
  }
  const key: CryptoKey = await crypto.subtle.importKey("jwk", jwk, ECDSA_P256, false, ["verify"]);
  const data: Uint8Array<ArrayBuffer> = new TextEncoder().encode(envelope.payload);
  const valid: boolean = await crypto.subtle.verify(ES256, key, signature, data);
  if (!valid) throw new PolicySignatureError("signature does not match the payload");
  return envelope.payload;
}
