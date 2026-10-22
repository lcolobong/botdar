import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { trustedKeys } from "../../../src/core/policy/publicKey.ts";
import {
  PolicySignatureError,
  decodeBase64Url,
  parseEnvelope,
  verifyEnvelope,
} from "../../../src/core/policy/verify.ts";
import type { SignedPolicyEnvelope } from "../../../src/core/policy/verify.ts";

interface TestKeypair {
  kid: string;
  publicJwk: JsonWebKey;
  privateKeyPem: string;
}

const testKeypair: TestKeypair = JSON.parse(
  readFileSync(new URL("../../fixtures/policy/test-keypair.json", import.meta.url), "utf8"),
) as TestKeypair;
const testKeys: Record<string, JsonWebKey> = { [testKeypair.kid]: testKeypair.publicJwk };
const payload = '{"schema":1,"version":1}';

function signPayload(text: string, privateKey: KeyObject): string {
  return sign("sha256", Buffer.from(text, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
}

function signedEnvelope(text: string = payload): SignedPolicyEnvelope {
  return {
    alg: "ES256",
    kid: testKeypair.kid,
    payload: text,
    sig: signPayload(text, createPrivateKey(testKeypair.privateKeyPem)),
  };
}

async function expectSignatureError(envelope: SignedPolicyEnvelope, detail: RegExp): Promise<void> {
  await expect(verifyEnvelope(envelope, testKeys)).rejects.toThrow(PolicySignatureError);
  await expect(verifyEnvelope(envelope, testKeys)).rejects.toThrow(detail);
}

describe("verifyEnvelope", () => {
  it("resolves to the payload of a valid envelope", async () => {
    await expect(verifyEnvelope(signedEnvelope(), testKeys)).resolves.toBe(payload);
  });

  it("rejects a tampered payload", async () => {
    const envelope: SignedPolicyEnvelope = {
      ...signedEnvelope(),
      payload: '{"schema":1,"version":2}',
    };
    await expectSignatureError(envelope, /does not match/);
  });

  it("rejects a signature made with another key", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const envelope: SignedPolicyEnvelope = {
      ...signedEnvelope(),
      sig: signPayload(payload, privateKey),
    };
    await expectSignatureError(envelope, /does not match/);
  });

  it("rejects a signature that is not base64url", async () => {
    await expectSignatureError({ ...signedEnvelope(), sig: "not+base64/url==" }, /base64url/);
  });

  it("rejects a signature of the wrong length", async () => {
    await expectSignatureError({ ...signedEnvelope(), sig: "AAAA" }, /64-byte/);
  });

  it("rejects an unknown kid", async () => {
    await expectSignatureError({ ...signedEnvelope(), kid: "2099-01" }, /unknown kid 2099-01/);
  });

  it("does not resolve a kid through the prototype chain", async () => {
    await expectSignatureError({ ...signedEnvelope(), kid: "constructor" }, /unknown kid/);
  });

  it("does not trust the test key under the baked kids", async () => {
    const envelope: SignedPolicyEnvelope = signedEnvelope();
    for (const kid of Object.keys(trustedKeys)) {
      await expect(verifyEnvelope({ ...envelope, kid }, trustedKeys)).rejects.toThrow(
        PolicySignatureError,
      );
    }
  });
});

describe("parseEnvelope", () => {
  it("returns a plain copy of a well-formed envelope", () => {
    const envelope: SignedPolicyEnvelope = signedEnvelope();
    expect(parseEnvelope(envelope)).toEqual(envelope);
    expect(parseEnvelope(envelope)).not.toBe(envelope);
  });

  it.each([[null], [[]], ["envelope"], [1]])("rejects a non-object %p", (input) => {
    expect(() => parseEnvelope(input)).toThrow(/envelope: expected an object/);
  });

  it("rejects an unknown key", () => {
    expect(() => parseEnvelope({ ...signedEnvelope(), extra: 1 })).toThrow(/envelope.extra/);
  });

  it("rejects an algorithm other than ES256", () => {
    expect(() => parseEnvelope({ ...signedEnvelope(), alg: "none" })).toThrow(/envelope.alg/);
    expect(() => parseEnvelope({ ...signedEnvelope(), alg: "HS256" })).toThrow(/envelope.alg/);
  });

  it.each([
    ["kid", undefined],
    ["kid", ""],
    ["kid", 1],
    ["payload", undefined],
    ["payload", ""],
    ["payload", {}],
    ["sig", undefined],
    ["sig", ""],
    ["sig", 7],
  ])("rejects %s = %p", (field, value) => {
    expect(() => parseEnvelope({ ...signedEnvelope(), [field]: value })).toThrow(
      new RegExp(`envelope.${field}`),
    );
  });

  it("rejects a payload larger than the size cap", () => {
    const envelope: SignedPolicyEnvelope = {
      ...signedEnvelope(),
      payload: "x".repeat(256 * 1024 + 1),
    };
    expect(() => parseEnvelope(envelope)).toThrow(/envelope.payload: larger/);
  });
});

describe("decodeBase64Url", () => {
  it("decodes unpadded base64url", () => {
    expect(Array.from(decodeBase64Url("_-8"))).toEqual([255, 239]);
    expect(Array.from(decodeBase64Url(""))).toEqual([]);
  });

  it.each(["AB=", "A", "A B", "AB+"])("rejects %p", (text) => {
    expect(() => decodeBase64Url(text)).toThrow(PolicySignatureError);
  });
});
