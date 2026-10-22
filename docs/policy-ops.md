# Policy operations runbook

The signed policy file is the kill switch. This page is the procedure for using it. Design rationale is in
[decisions/ADR-0007](decisions/ADR-0007-signed-restrict-only-policy.md); format and verification in
[architecture.md](architecture.md).

## What the policy can do

- Disable a whole platform (`platforms.x.enabled = false`).
- Disable Tier 1 (passive interception) or Tier 2 (active lookups) per platform.
- Lower a feature's cap, weaken or neutralise its bins or weight (never strengthen them), raise
  thresholds (never lower them), move the prior toward "typical".
- Lower the Tier 2 rate limit.
- Supply the current X `AboutAccountQuery` query id after X rotates it.
- Show a one-time notice in the popup.

## What the policy cannot do

Enable anything the build has off, raise a cap above the build default, raise a bin or weight above
the build's value for that bin, lower a threshold below the build default, raise the prior above the
build default (it may only move it toward "typical"), name a platform or feature the build does not
know, or run code. Invalid signature, invalid
schema, or a version lower than the cached one are all ignored and the last-known-good stays.

## Procedure: flip a switch

1. Edit `policy/src/v1.json`. Bump `version` by one. Set `issuedAt` to now.
2. Run `pnpm policy:sign`. It validates, asserts the version increased, signs with the key from
   `POLICY_SIGNING_KEY` (PEM in the environment, pasted from the password manager) and writes
   `policy/dist/v1.json`.
3. Run `pnpm policy:verify`. It must print the version and `ok`.
4. Commit both files with a message that says what changed and why. Push to main.
5. The Pages workflow verifies the signature again and deploys. Confirm at
   `https://lcolobong.github.io/botdar/policy/v1.json`.
6. Extensions pick it up on their next alarm (daily, jittered). To verify locally: open the service worker
   console, run the refresh message, and check `policy.lkg` in storage.
7. Record the change in the tracker and, if it was a response to an incident, in the risk register.

## Procedure: rotate the signing key

1. Generate a new pair with `pnpm policy:keygen`. Store the private key in the password manager under a
   new `kid`. Never write it to disk inside the repo.
2. Add the new public JWK to `src/core/policy/publicKey.ts` alongside the old one. Ship a release.
3. After most users have updated (store stats), sign with the new key and remove the old public key in
   the following release.

## Procedure: suspected key compromise

1. Immediately ship a release that removes the compromised public key and adds a fresh one.
2. Sign a new policy with the fresh key.
3. Because the policy is restrict-only, the worst a stolen key can do is turn features off; it cannot
   enable anything. Say so in the incident note.

## Procedure: platform complaint or takedown pressure

1. Disable the affected tier or platform by policy the same day.
2. Open an incident note in `docs/incidents/` with what was asked, what was switched off, and the user
   notice text.
3. Decide separately whether a release is needed.
