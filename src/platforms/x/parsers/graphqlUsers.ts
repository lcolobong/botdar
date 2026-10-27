/**
 * The X GraphQL parser's public surface. The code lives in ./graphql/: the bounded body walk in
 * walk.ts, the user and post readers, owner-post counting, signals and the AboutAccountQuery
 * projection beside it.
 */
export { parseAboutAccount, toAboutSignals } from "./graphql/aboutAccount";
export type { ParsedAboutAccount } from "./graphql/aboutAccount";
export {
  profileTimelineUserIdOf,
  repliesTabOwnerTweets,
  timelineOwnerPosts,
} from "./graphql/ownerPosts";
export type { OwnerPosts, TimelineOwnerPosts } from "./graphql/ownerPosts";
export { toSignals } from "./graphql/signals";
export type { ParsedXBody, ParsedXPost, ParsedXUser } from "./graphql/types";
export { parseXTimestamp } from "./graphql/userFields";
export { collectUsers, parseGraphqlBody, postTextByHandle } from "./graphql/walk";
