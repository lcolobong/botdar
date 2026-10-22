/**
 * Public halves of the policy signing keys, keyed by kid (ADR-0009). Managed by
 * scripts/policy-keygen.ts, which adds a new kid and drops the placeholder; the private halves live
 * in the maintainer's password manager and nowhere in this repository. Rotation keeps the previous
 * kid for one release so a policy signed before the rotation still verifies.
 */
export const trustedKeys: Record<string, JsonWebKey> = {
  placeholder: {
    kty: "EC",
    crv: "P-256",
    x: "MK-aG4kQrlWBqrKOwuACAzRBYudnVrOG5yy30Q3bbmg",
    y: "G_EeNmd-g7tXxAtuwIWPjq8kJ29CQ0DLDjyrj6zT1Qk",
  },
};
