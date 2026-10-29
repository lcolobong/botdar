import { describe, expect, it } from "vitest";
import {
  isAssignedCodeHandle,
  isHandleLongEnough,
  isUserPrefixedHandle,
} from "@/src/core/handleRules";

describe("handle rules", () => {
  it("counts a handle in code points", () => {
    expect(isHandleLongEnough("ab")).toBe(false);
    expect(isHandleLongEnough("abc")).toBe(true);
    expect(isHandleLongEnough("\u{1D49C}\u{1D4B7}")).toBe(false);
  });

  it("recognises a user-prefixed handle in any case", () => {
    expect(isUserPrefixedHandle("user-zk8ed4kd2b")).toBe(true);
    expect(isUserPrefixedHandle("User-ZK8ED4KD2B")).toBe(true);
    expect(isUserPrefixedHandle("user-short")).toBe(false);
  });

  it("recognises an assigned code only when it mixes a letter and a digit, in any case", () => {
    expect(isAssignedCodeHandle("LarryH-h6q")).toBe(true);
    expect(isAssignedCodeHandle("LarryH-H6Q")).toBe(true);
    expect(isAssignedCodeHandle("club-007")).toBe(false);
    expect(isAssignedCodeHandle("club-abc")).toBe(false);
  });
});
