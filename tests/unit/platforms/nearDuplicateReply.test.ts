import {
  NEAR_DUPLICATE_REPLY_FEATURE,
  nearDuplicateReplyFeatures,
} from "@/src/core/scoring/featureSupport";

describe("nearDuplicateReplyFeatures", () => {
  it("turns the thread index's count into Tier 0 coordination evidence", () => {
    expect(nearDuplicateReplyFeatures(3)).toEqual([
      { id: NEAR_DUPLICATE_REPLY_FEATURE, value: 3, group: "coordination", tier: 0 },
    ]);
  });

  it("keeps a count of 0, which weighs nothing", () => {
    expect(nearDuplicateReplyFeatures(0).map((feature) => feature.value)).toEqual([0]);
  });

  it("omits the feature when the account has no comparable reply on the page", () => {
    expect(nearDuplicateReplyFeatures(undefined)).toEqual([]);
  });
});
