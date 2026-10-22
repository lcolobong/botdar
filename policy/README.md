# Policy files

The signed remote policy is Botdar's kill switch: it can disable a platform or a tier, lower caps and
rate limits, and show a one-time notice, but it can never enable anything the build has off. The
procedure for changing it is in [docs/policy-ops.md](../docs/policy-ops.md); the format, verification
flow and restrict-only merge are in [docs/architecture.md](../docs/architecture.md) ("Policy system").

| Path | Role |
| --- | --- |
| `src/v1.json` | The unsigned source. Edit this, bump `version`, set `issuedAt`. |
| `dist/v1.json` | The signed envelope the extension fetches. Written only by `pnpm policy:sign`. Served at `https://lcolobong.github.io/botdar/policy/v1.json`. |

| Command | Does |
| --- | --- |
| `pnpm policy:keygen` | New P-256 keypair. Prints the private key to stdout only; bakes the public JWK into `src/core/policy/publicKey.ts`. |
| `pnpm policy:sign` | Validates `src/v1.json`, asserts the version increased, signs with `POLICY_SIGNING_KEY` (PEM) or `--key-file`, writes `dist/v1.json`. |
| `pnpm policy:verify` | Verifies `dist/v1.json` against the baked keys through the extension's own code path. The Pages workflow runs this and never signs. |

The private key lives in the maintainer's password manager and nowhere in this repository.
