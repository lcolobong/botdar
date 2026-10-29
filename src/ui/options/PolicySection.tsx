import { useState } from "preact/hooks";
import { sendRequest } from "@/src/core/messaging";
import { policyFetchedLine, policyVersionLine } from "@/src/ui/policyStatus";
import type { PolicyStatus } from "@/src/ui/policyStatus";
import { SettingsRow } from "./SettingsRow";

export interface PolicySectionProps {
  status: PolicyStatus;
  now: () => number;
  /** Reloads the page's data, so a refreshed policy shows its new version and fetch time. */
  reload: () => void;
}

export function PolicySection({ status, now, reload }: PolicySectionProps) {
  const [checking, setChecking] = useState(false);

  const checkPolicyNow = (): void => {
    setChecking(true);
    // The background answers after its fetch; a missing handler only means no refresh happened.
    void sendRequest({ type: "policy.refresh" })
      .catch(() => undefined)
      .then(() => {
        setChecking(false);
        reload();
      });
  };

  return (
    <>
      <h2>Policy</h2>
      <SettingsRow title={policyVersionLine(status)} caption={policyFetchedLine(status, now())}>
        <button type="button" class="bd-btn" disabled={checking} onClick={checkPolicyNow}>
          Check now
        </button>
      </SettingsRow>
    </>
  );
}
