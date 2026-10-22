# Release checklist

Copy this list into the release PR and check every item.

## Code

- [ ] CI green on main: lint, typecheck, unit, DOM tests, Chrome and Firefox builds.
- [ ] Version bumped in `package.json` and `wxt.config.ts`; changelog entry written.
- [ ] Every commit in the release is under the production line ceiling or justified in its message.
- [ ] No `web_accessible_resources`, no `<all_urls>`, host permissions match the shipped platforms.
- [ ] Firefox manifest carries `data_collection_permissions`.

## Policy

- [ ] `policy/dist/v1.json` verifies with the baked public key (`pnpm policy:verify`).
- [ ] `minExtensionVersion` in the policy is not above the version being shipped.
- [ ] Signing key is in the password manager; no key material in the repo or CI logs.

## Verification

- [ ] [test-plan.md](test-plan.md) manual checklist completed on Chrome and Firefox.
- [ ] Data-egress check passed on each platform.
- [ ] Calibration pass done (first release) or thresholds reviewed (later releases).
- [ ] Before/after media captured for every user-visible change.

## Docs and paper trail

- [ ] `docs/` updated for every behavior change in the release.
- [ ] ADR written for any new decision.
- [ ] Risk register reviewed; triggers unchanged or updated.
- [ ] Notion wiki mirror refreshed; tracker rows for the release set to Done.
- [ ] Privacy page on GitHub Pages matches the shipped behavior.

## Store

- [ ] Chrome Web Store listing: description, screenshots per platform, promo tiles, category, single-purpose
  statement, data-use disclosure ("nothing leaves the browser except a daily signed policy fetch").
- [ ] Justification paragraph for MAIN-world fetch interception ready for a reviewer question.
- [ ] Firefox AMO submission with pre-minified source archive.
- [ ] GitHub Release created from the tag with both zips attached.

## After publishing

- [ ] Install from the store on a clean profile; run the manual checklist once more.
- [ ] Watch store reviews and the feedback export rate for the first week.
- [ ] Record the release date in the roadmap.
