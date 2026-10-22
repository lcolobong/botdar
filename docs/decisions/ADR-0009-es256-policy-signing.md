# ADR-0009: ES256 policy signing with WebCrypto verification

Status: Accepted
Date: 2026-10-22

## Context

The remote policy (ADR-0007) must be tamper-evident. The verifier runs in a Manifest V3 service worker
in Chrome and in Firefox's background event page, where WebCrypto is the only available primitive
without adding a dependency. Ed25519 in WebCrypto only reached broad browser support recently and is
still uneven across Safari versions, which matters for the planned Safari build. ECDSA P-256 with
SHA-256 has been universally supported in WebCrypto for years, and Node's `crypto.sign` can emit the
raw `r||s` (IEEE P1363) form WebCrypto expects.

## Decision

- Algorithm: ECDSA on P-256 with SHA-256 (JOSE name ES256). Signature encoded as raw `r||s`, base64url.
- Envelope: `{ "alg": "ES256", "kid": "<key id>", "payload": "<policy JSON as a string>", "sig": "..." }`.
  The payload is signed as an opaque UTF-8 string so no JSON canonicalization is needed.
- The public key is baked into the build as a JWK in `src/core/policy/publicKey.ts` with its `kid`.
- `scripts/policy-keygen.ts` prints the private key once to stdout and writes only the public JWK into
  the repo. The private key lives in the maintainer's password manager and nowhere else.
- `scripts/policy-sign.ts` signs locally from an environment variable or a key file outside the repo.
- The GitHub Pages deploy workflow runs `scripts/policy-verify.ts` before publishing and never signs;
  an unsigned or tampered `policy/dist/v1.json` cannot be deployed.
- Rotation: generate a new key with a new `kid`, ship the new public key in an extension release while
  still accepting the old `kid` for one release, then drop it.

## Consequences

- Zero runtime dependencies for verification.
- Losing the private key means a new key must ship in an extension release before any new policy can
  be accepted; until then the last-known-good policy applies. The risk register tracks this.
- Test fixtures need a separate throwaway keypair; the real public key must never be used in tests
  with its private half committed anywhere.

## Alternatives considered

- **Ed25519.** Rejected for WebCrypto support unevenness across the Safari path.
- **HMAC.** Rejected: a shared secret would have to ship in the extension.
- **Unsigned file over HTTPS.** Rejected: GitHub Pages and the repo are a single point of compromise.
