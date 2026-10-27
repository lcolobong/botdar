import type { UnknownRecord } from "@/src/core/json/untrusted";
import { readBoolean, readRecord, readString } from "@/src/core/json/untrusted";

const AUTOMATED_LABEL_TYPE = "AutomatedLabel";

/**
 * X's "Automated" label has not yet been confirmed in a recorded response (day-one validation 8 in
 * docs/architecture.md). Two candidate locations are read: a `legacy.automated` boolean and the
 * affiliates label with `userLabelType === "AutomatedLabel"`. An affiliates label that is present but
 * empty, which is what most users carry, reads as "observed, not automated"; no label object at all
 * stays unobserved so the engine cannot mistake a schema change for a human account.
 */
export function declaredAutomatedOf(node: UnknownRecord): boolean | undefined {
  const legacyFlag: boolean | undefined = readBoolean(readRecord(node, "legacy"), "automated");
  if (legacyFlag !== undefined) {
    return legacyFlag;
  }
  const affiliatesLabel: UnknownRecord | undefined = readRecord(
    node,
    "affiliates_highlighted_label",
  );
  if (affiliatesLabel === undefined) {
    return undefined;
  }
  return readString(readRecord(affiliatesLabel, "label"), "userLabelType") === AUTOMATED_LABEL_TYPE;
}
