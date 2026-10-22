/**
 * Public halves of the policy signing keys, keyed by kid (ADR-0009). Managed by
 * scripts/policy-keygen.ts, which adds a new kid and drops the placeholder; the private halves live
 * in the maintainer's password manager and nowhere in this repository. Rotation keeps the previous
 * kid for one release so a policy signed before the rotation still verifies.
 */
export const trustedKeys: Record<string, JsonWebKey> = {
  "2026-10": {
    kty: "EC",
    crv: "P-256",
    x: "gg7xE9YpnO8NP_SzB0qF-1V-lX6Lp4AhwHYIbCmfk5E",
    y: "EYcXxOK2Zf3zupaioCyU29KncpcAErTiIC3vglxs1fc",
  },
};
