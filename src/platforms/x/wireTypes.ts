import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { FeedbackEntry, FeedbackInput } from "@/src/core/feedback";
import type { AccountResolver, BadgeHandle } from "@/src/core/pipeline";
import type { Settings } from "@/src/core/settings";
import type { EffectivePlatformConfig, PlatformAdapter, PostRef, Verdict } from "@/src/core/types";
import type { MountedUi } from "@/src/ui/mount";

export interface WireOptions {
  ctx: ContentScriptContext;
  adapter: PlatformAdapter;
  resolver: AccountResolver;
  /** Shadow-root stylesheet text: `shadowStyles` of the entrypoint's `?inline` imports. */
  shadowCss: string;
  settings: () => Settings;
  config: () => EffectivePlatformConfig;
  /** Platform-owned DOM marks that let later observer passes skip badged posts at selector level. */
  markBadged: (element: Element) => void;
  unmarkBadged: (element: Element) => void;
  recordFeedback: (input: FeedbackInput) => Promise<FeedbackEntry>;
  removeFeedback: (id: string) => Promise<boolean>;
  openSettings: () => void;
  /** Display prefix for the card's handle line, e.g. "@" or "u/". */
  handlePrefix: string;
}

export interface PlatformWiring {
  attach: (post: PostRef) => void;
  release: (element: Element) => void;
  /** Settings or config changed: redraw every badge and the open card. */
  refresh: () => void;
  stop: () => void;
}

export interface PostState {
  post: PostRef;
  handle: BadgeHandle;
  verdict: Verdict;
  unsubscribe: () => void;
  badge: MountedUi | undefined;
  badgeContainer: HTMLElement | undefined;
  mounting: boolean;
  released: boolean;
  loading: boolean;
}
