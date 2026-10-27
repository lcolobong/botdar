import { SharedDomainIndex } from "@/src/core/thread/sharedDomainIndex";
import type { ReplyPlacement } from "@/src/core/thread/threadIndex";
import { MAX_INDEXED_REPLIES } from "@/src/core/thread/threadIndex";

const THREAD = "root-1";
const RARE = new Set(["example-gazette.net"]);

let sequence = 0;

function place(author: string, postedAt: number, overrides: Partial<ReplyPlacement> = {}) {
  sequence += 1;
  return { threadKey: THREAD, replyId: `reply-${sequence}`, author, postedAt, ...overrides };
}

/** Records a reply and the domains it links, as a DOM reader does. */
function link(
  index: SharedDomainIndex,
  author: string,
  postedAt: number,
  domains: ReadonlySet<string> = RARE,
  overrides: Partial<ReplyPlacement> = {},
): ReplyPlacement {
  const reply: ReplyPlacement = place(author, postedAt, overrides);
  index.recordReply(reply);
  index.recordPostDomains(reply.replyId, domains);
  return reply;
}

describe("SharedDomainIndex", () => {
  it("counts other authors who linked the same domain earlier in the thread", () => {
    const index = new SharedDomainIndex();
    for (const [position, author] of ["a", "b", "c", "d", "e"].entries()) {
      link(index, author, position);
    }
    expect(index.sharedDomainCount("a")).toBe(0);
    expect(index.sharedDomainCount("c")).toBe(2);
    expect(index.sharedDomainCount("e")).toBe(4);
  });

  it("never counts for the earliest linker, whatever order the replies arrive in", () => {
    const index = new SharedDomainIndex();
    link(index, "late", 30);
    link(index, "middle", 20);
    link(index, "first", 10);
    expect(index.sharedDomainCount("first")).toBe(0);
    expect(index.sharedDomainCount("late")).toBe(2);
  });

  it("counts an author once, and neither the reply's own parent nor a tie", () => {
    const index = new SharedDomainIndex();
    const parent: ReplyPlacement = link(index, "parent", 1);
    link(index, "repeater", 2);
    link(index, "repeater", 3);
    link(index, "tied", 4);
    link(index, "answer", 4, RARE, { parentId: parent.replyId });
    expect(index.sharedDomainCount("answer")).toBe(1);
  });

  it("keeps threads and domains apart", () => {
    const index = new SharedDomainIndex();
    link(index, "elsewhere", 1, RARE, { threadKey: "root-2" });
    link(index, "other-site", 2, new Set(["another-blog.org"]));
    link(index, "asked", 3);
    expect(index.sharedDomainCount("asked")).toBe(0);
  });

  it("answers the most over the author's replies and their domains", () => {
    const index = new SharedDomainIndex();
    link(index, "a", 1, new Set(["one.example"]));
    link(index, "b", 2, new Set(["two.example"]));
    link(index, "c", 3, new Set(["two.example"]));
    link(index, "asked", 4, new Set(["one.example", "two.example"]));
    expect(index.sharedDomainCount("asked")).toBe(2);
  });

  it("has no answer for an author none of whose replies links a domain", () => {
    const index = new SharedDomainIndex();
    index.recordReply(place("quiet", 1));
    expect(index.sharedDomainCount("quiet")).toBeUndefined();
    expect(index.sharedDomainCount("stranger")).toBeUndefined();
  });

  it("joins domains that arrive before or after the reply's place, by post id", () => {
    const index = new SharedDomainIndex();
    index.recordPostDomains("status-2", RARE);
    index.recordReply(place("first", 1, { replyId: "status-1" }));
    index.recordReply(place("second", 2, { replyId: "status-2" }));
    index.recordPostDomains("status-1", RARE);
    expect(index.sharedDomainCount("second")).toBe(1);
  });

  it("never counts the domain the root post links", () => {
    const index = new SharedDomainIndex();
    link(index, "a", 1);
    link(index, "b", 2);
    index.recordRootDomains(THREAD, RARE);
    expect(index.sharedDomainCount("b")).toBeUndefined();
  });

  it("tells the listeners when a later record changes an answered count", () => {
    const index = new SharedDomainIndex();
    const listener = vi.fn();
    index.subscribe(listener);
    link(index, "b", 2);
    expect(index.sharedDomainCount("b")).toBe(0);
    link(index, "a", 1);
    expect(listener).toHaveBeenLastCalledWith(["b"]);
    expect(index.sharedDomainCount("b")).toBe(1);
    index.recordRootDomains(THREAD, RARE);
    expect(listener).toHaveBeenLastCalledWith(["b"]);
    expect(index.sharedDomainCount("b")).toBeUndefined();
  });

  it("forgets places on navigation but keeps each post's domains for its replies' return", () => {
    const index = new SharedDomainIndex();
    const listener = vi.fn();
    index.subscribe(listener);
    index.recordPostDomains("status-1", RARE);
    index.recordPostDomains("status-2", RARE);
    index.recordReply(place("first", 1, { replyId: "status-1" }));
    index.recordReply(place("second", 2, { replyId: "status-2" }));
    expect(index.sharedDomainCount("second")).toBe(1);
    index.clear();
    expect(listener).toHaveBeenCalledWith(["second"]);
    expect(index.sharedDomainCount("second")).toBeUndefined();

    const returned = new SharedDomainIndex();
    returned.recordPostDomains("status-1", RARE);
    returned.recordPostDomains("status-2", RARE);
    returned.clear();
    returned.recordReply(place("first", 1, { replyId: "status-1" }));
    returned.recordReply(place("second", 2, { replyId: "status-2" }));
    expect(returned.sharedDomainCount("second")).toBe(1);
  });

  it("drops the oldest post's domains past the cap", () => {
    const index = new SharedDomainIndex();
    for (let post = 0; post <= MAX_INDEXED_REPLIES; post += 1) {
      index.recordPostDomains(`post-${post}`, RARE);
    }
    index.recordReply(place("evicted", 1, { replyId: "post-0" }));
    index.recordReply(place("kept", 2, { replyId: `post-${MAX_INDEXED_REPLIES}` }));
    expect(index.sharedDomainCount("evicted")).toBeUndefined();
    expect(index.sharedDomainCount("kept")).toBe(0);
  });

  it("keeps a thread's root domains however many posts' domains arrive after them", () => {
    const index = new SharedDomainIndex();
    index.recordRootDomains(THREAD, RARE);
    for (let post = 0; post < MAX_INDEXED_REPLIES; post += 1) {
      index.recordPostDomains(`elsewhere-${post}`, new Set(["another-blog.org"]));
    }
    for (const [position, author] of ["a", "b", "c", "d"].entries()) {
      link(index, author, position);
    }
    expect(index.sharedDomainCount("d")).toBeUndefined();
  });

  it("stops counting an evicted reply for everyone, its own author included", () => {
    const index = new SharedDomainIndex();
    link(index, "a0", 0);
    expect(index.sharedDomainCount("a0")).toBe(0);
    for (let post = 0; post < MAX_INDEXED_REPLIES; post += 1) {
      index.recordPostDomains(`elsewhere-${post}`, new Set(["another-blog.org"]));
    }
    link(index, "a1", 1);
    expect(index.sharedDomainCount("a0")).toBeUndefined();
    expect(index.sharedDomainCount("a1")).toBe(0);
  });

  it("tells a later linker when an earlier reply it counted is evicted", () => {
    const index = new SharedDomainIndex();
    const listener = vi.fn();
    index.subscribe(listener);
    link(index, "a0", 0);
    link(index, "a1", 1);
    expect(index.sharedDomainCount("a1")).toBe(1);
    for (let post = 0; post < MAX_INDEXED_REPLIES - 1; post += 1) {
      index.recordPostDomains(`elsewhere-${post}`, new Set(["another-blog.org"]));
    }
    expect(listener).toHaveBeenCalledWith(["a1"]);
    expect(index.sharedDomainCount("a1")).toBe(0);
  });
});
