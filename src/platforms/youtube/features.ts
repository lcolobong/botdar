/**
 * YouTube feature extraction. Each feature id, group, input and gate comes from the YouTube table in
 * docs/scoring-spec.md. Gating is this module's job: a feature whose gate is not met is omitted, and
 * the engine never sees it. The page shows a commenter's handle (Tier 0); the channel's
 * About panel, fetched on hover, gives its age, videos, description and name (Tier 2). Whether an
 * account poses as the video's creator depends on the page, so the adapter passes the creator in.
 */
import { DAY_MILLIS, tierOf } from "../../core/scoring/featureSupport";
import type {
  AccountSignals,
  Feature,
  IndependenceGroup,
  SignalField,
  SourceTier,
} from "../../core/types";
import type { VideoCreator } from "./handles";
import { imitatesCreator, isAssignedHandle } from "./handles";

/** The handle is rendered on every comment, so the features that read it are Tier 0 evidence. */
const HANDLE_TIER: SourceTier = 0;
export const IMITATES_CREATOR_FEATURE = "youtube.imitatesCreator";
/** What `youtube.imitatesCreator` matched, for the reason line. */
export type ImitationSource = "handle" | "name";

/**
 * The handle is checked first because the page shows it; the channel name only once Tier 2 has
 * read it. The creator's own account never imitates itself, whichever handle the page names it by.
 */
function imitationOf(
  signals: AccountSignals,
  creator: VideoCreator | undefined,
): ImitationSource | undefined {
  if (creator === undefined || creator.handles.has(signals.ref.handle.toLowerCase())) {
    return undefined;
  }
  if (imitatesCreator(signals.ref.handle, creator)) return "handle";
  const name: string | undefined = signals.displayName;
  return name !== undefined && imitatesCreator(name, creator) ? "name" : undefined;
}

export function toFeatures(
  signals: AccountSignals,
  creator?: VideoCreator,
  now: number = Date.now(),
): Feature[] {
  const features: Feature[] = [];
  const add = (
    id: string,
    value: number | boolean,
    group: IndependenceGroup,
    fields: SignalField[],
  ): void => {
    features.push({ id, value, group, tier: tierOf(signals, fields) });
  };

  if (signals.createdAt !== undefined) {
    add("youtube.channelAgeDays", Math.max((now - signals.createdAt) / DAY_MILLIS, 0), "age", [
      "createdAt",
    ]);
  }
  // Most commenters upload nothing and leave the description empty (44 and 48 of 57 sampled on
  // 2026-10-27), so only the effort counts, towards ordinary; its absence weighs nothing.
  if (signals.postCount !== undefined) {
    add("youtube.hasVideos", signals.postCount > 0, "profile", ["postCount"]);
  }
  if (signals.bio !== undefined) {
    add("youtube.hasDescription", signals.bio.length > 0, "profile", ["bio"]);
  }
  features.push({
    id: "youtube.assignedHandle",
    value: isAssignedHandle(signals.ref.handle),
    group: "handle",
    tier: HANDLE_TIER,
  });
  const imitation: ImitationSource | undefined = imitationOf(signals, creator);
  if (imitation !== undefined) {
    features.push({
      id: IMITATES_CREATOR_FEATURE,
      value: true,
      group: "handle",
      tier: imitation === "handle" ? HANDLE_TIER : tierOf(signals, ["displayName"]),
      detail: imitation,
    });
  }
  return features;
}
