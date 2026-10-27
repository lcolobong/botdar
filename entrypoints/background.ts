import { registerConfigBroker } from "../src/background/configBroker.ts";
import { registerLookupSweep } from "../src/background/lookupSweep.ts";
import { registerOnboardingOnInstall } from "../src/background/onboarding.ts";
import { registerPolicyRefresh } from "../src/core/policy/loader.ts";

export default defineBackground(() => {
  registerOnboardingOnInstall();
  registerConfigBroker();
  registerPolicyRefresh();
  registerLookupSweep();
});
