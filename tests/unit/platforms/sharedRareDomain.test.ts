import {
  SHARED_RARE_DOMAIN_FEATURE,
  sharedRareDomainFeatures,
} from "@/src/core/scoring/featureSupport";

describe("sharedRareDomainFeatures", () => {
  it("turns the thread index's count into coordination evidence at the links' tier", () => {
    expect(sharedRareDomainFeatures(4, 0)).toEqual([
      { id: SHARED_RARE_DOMAIN_FEATURE, value: 4, group: "coordination", tier: 0 },
    ]);
    expect(sharedRareDomainFeatures(4, 1).map((feature) => feature.tier)).toEqual([1]);
  });

  it("keeps a count of 0, which weighs nothing", () => {
    expect(sharedRareDomainFeatures(0, 0).map((feature) => feature.value)).toEqual([0]);
  });

  it("omits the feature when no reply of the account links a domain that counts", () => {
    expect(sharedRareDomainFeatures(undefined, 0)).toEqual([]);
  });
});
