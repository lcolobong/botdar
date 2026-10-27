/**
 * Tier 1 for X: the passive source that turns relayed GraphQL bodies into signals. Bodies arrive
 * from the MAIN-world interceptor and are untrusted page data; the parsers run type guards and
 * never throw, so this source only routes. It is reachable only through the policy merge: the
 * pipeline starts it when `tiers.t1` is on.
 */
import { onRelay } from "@/src/core/relay";
import type { PartialSignals, ReplyShare, SignalSource } from "@/src/core/types";
import {
  ABOUT_ACCOUNT_OPERATION,
  PROFILE_REPLIES_OPERATION,
  PROFILE_TIMELINE_OPERATION,
  X_GRAPHQL_RELAY_KIND,
} from "../graphqlRoutes";
import type {
  ParsedAboutAccount,
  ParsedXBody,
  TimelineOwnerPosts,
  OwnerPosts,
} from "../parsers/graphqlUsers";
import {
  parseAboutAccount,
  parseGraphqlBody,
  postTextByHandle,
  profileTimelineUserIdOf,
  repliesTabOwnerTweets,
  timelineOwnerPosts,
  toAboutSignals,
  toSignals,
} from "../parsers/graphqlUsers";

export const PASSIVE_GRAPHQL_SOURCE_ID = "x.graphql";

/**
 * Relayed page data may nudge a score but never sets the declared override (docs/architecture.md,
 * threat model): the Tier 0 Automated label and the Tier 2 About lookup are the only sources of
 * `declaredAutomated`, so a page that forges a relayed body cannot flip a badge to Declared.
 */
function withoutDeclaredOverride(signals: PartialSignals): PartialSignals {
  const relayed: PartialSignals = { ...signals };
  delete relayed.declaredAutomated;
  return relayed;
}

/** Whether each tweet of one replies-tab owner was a reply, by tweet id, across the pages seen. */
type ReplyFlagsByTweetId = Map<string, boolean>;

const MAX_TRACKED_REPLIES_OWNERS = 20;
const MAX_TRACKED_TWEETS_PER_OWNER = 1_000;

/**
 * Adds a replies-tab page to its owner's running tally and returns the tally's share. The tab arrives
 * a page at a time, and a short page must neither stand for the profile nor replace a longer sample,
 * so the tally is cumulative. It is kept here, by tweet id, rather than in the merge: a re-fetched or
 * overlapping page then adds nothing, which counts in the merge could not tell. Memory is bounded: the
 * oldest tracked owner goes first, and an owner stops growing at the sample the detector can use.
 */
function tallyReplyShare(
  flagsByOwner: Map<string, ReplyFlagsByTweetId>,
  ownerId: string,
  owner: OwnerPosts,
): ReplyShare {
  const flags: ReplyFlagsByTweetId = flagsByOwner.get(ownerId) ?? new Map<string, boolean>();
  flagsByOwner.delete(ownerId);
  flagsByOwner.set(ownerId, flags);
  for (const tweet of owner.posts) {
    if (flags.size < MAX_TRACKED_TWEETS_PER_OWNER) {
      flags.set(tweet.id, tweet.isReply);
    }
  }
  for (const staleOwnerId of [...flagsByOwner.keys()].slice(
    0,
    Math.max(0, flagsByOwner.size - MAX_TRACKED_REPLIES_OWNERS),
  )) {
    flagsByOwner.delete(staleOwnerId);
  }
  const replies: number = [...flags.values()].filter(Boolean).length;
  return { ratio: replies / flags.size, sampleSize: flags.size };
}

/**
 * What a body's posts say about their authors: each author's post text, and the owner's own numbers
 * on a profile tab, the owner being the user the request named. On the posts tab (`UserTweets`) those
 * are the post times; post times from any other operation are a feed's, a thread's or the replies
 * tab's sample, a different population from the one the cadence features read. On the replies tab
 * (`UserTweetsAndReplies`) it is the reply share, from that tab alone: the posts tab holds no replies,
 * and a feed or a thread holds other people's.
 */
function postSignalsByHandle(
  parsed: ParsedXBody,
  op: string | undefined,
  query: string | undefined,
  replyFlagsByOwner: Map<string, ReplyFlagsByTweetId>,
): Map<string, PartialSignals> {
  const signalsByHandle = new Map<string, PartialSignals>();
  for (const [handle, postText] of postTextByHandle(parsed.posts)) {
    signalsByHandle.set(handle, { postText });
  }
  const ownerId: string | undefined = profileTimelineUserIdOf(query);
  if (op === PROFILE_TIMELINE_OPERATION) {
    const owner: TimelineOwnerPosts | undefined = timelineOwnerPosts(parsed.posts, ownerId);
    if (owner !== undefined) {
      signalsByHandle.set(owner.handle, {
        ...signalsByHandle.get(owner.handle),
        postTimestamps: owner.timestamps,
      });
    }
  }
  if (op === PROFILE_REPLIES_OPERATION && ownerId !== undefined) {
    const owner: OwnerPosts | undefined = repliesTabOwnerTweets(parsed.posts, ownerId);
    if (owner !== undefined) {
      signalsByHandle.set(owner.handle, {
        ...signalsByHandle.get(owner.handle),
        replyShare: tallyReplyShare(replyFlagsByOwner, ownerId, owner),
      });
    }
  }
  return signalsByHandle;
}

export function createPassiveGraphqlSource(target: Window = window): SignalSource {
  const replyFlagsByOwner = new Map<string, ReplyFlagsByTweetId>();
  return {
    id: PASSIVE_GRAPHQL_SOURCE_ID,
    platform: "x",
    tier: 1,
    kind: "passive",
    start: (emit) =>
      onRelay(
        X_GRAPHQL_RELAY_KIND,
        (envelope) => {
          const parsed: ParsedXBody = parseGraphqlBody(envelope.body);
          const postSignals: Map<string, PartialSignals> = postSignalsByHandle(
            parsed,
            envelope.op,
            envelope.query,
            replyFlagsByOwner,
          );
          for (const user of parsed.users) {
            emit(user.ref, {
              ...withoutDeclaredOverride(toSignals(user)),
              ...postSignals.get(user.ref.handle),
            });
          }
          if (envelope.op !== ABOUT_ACCOUNT_OPERATION) {
            return;
          }
          const about: ParsedAboutAccount | null = parseAboutAccount(envelope.body);
          if (about !== null) {
            emit(
              { platform: "x", handle: about.handle },
              withoutDeclaredOverride(toAboutSignals(about)),
            );
          }
        },
        target,
      ),
  };
}
