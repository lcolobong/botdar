import type { UnknownRecord } from "@/src/core/json/untrusted";
import type { AccountRef } from "@/src/core/types";

export interface ParsedXUser {
  ref: AccountRef;
  /** The raw user object as found in the response; read it through `toSignals`. */
  node: UnknownRecord;
}

export interface ParsedAboutAccount {
  handle: string;
  country?: string;
  usernameChanges?: number;
  appStore?: string;
  declaredAutomated?: boolean;
}

/** One post in a timeline body, attributed to its author. */
export interface ParsedXPost {
  id: string;
  author: AccountRef;
  text?: string;
  /** Epoch milliseconds. */
  createdAt?: number;
  /** Whether the post answers another post. A repost wrapper is never one. */
  isReply: boolean;
  /** The pages the post links, expanded from t.co (postLinks.ts); omitted when it links none. */
  links?: string[];
}

export interface ParsedXBody {
  users: ParsedXUser[];
  posts: ParsedXPost[];
}
