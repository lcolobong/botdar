/**
 * Summarises a V8 CPU profile recorded during a page load (see measure.ts, `profile`) down to the
 * extension's own code: self and total time per function in chrome-extension:// scripts. Profile an
 * unminified build (`--build`) so the function names mean something.
 */

/** The parts of CDP's Profiler.Profile this summary reads; Playwright does not export the type. */
export interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

interface ProfileNode {
  readonly id: number;
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
  };
  readonly children?: readonly number[];
}

export interface FunctionCost {
  readonly name: string;
  readonly location: string;
  readonly selfMs: number;
  readonly totalMs: number;
}

const EXTENSION_URL_PREFIX = "chrome-extension://";

function keyOf(node: ProfileNode): string {
  const { functionName, url, lineNumber, columnNumber } = node.callFrame;
  const file: string = url.split("/").slice(3).join("/");
  // Profiler positions are zero-based; editors and the docs count from one.
  return `${functionName || "(anonymous)"}\t${file}:${lineNumber + 1}:${columnNumber + 1}`;
}

/** Functions in extension scripts by self time, with total time counted once per call stack. */
export function extensionCosts(profile: CpuProfile): FunctionCost[] {
  const selfMsById = new Map<number, number>();
  profile.samples?.forEach((nodeId, index) => {
    const deltaMs: number = (profile.timeDeltas?.[index + 1] ?? 0) / 1_000;
    selfMsById.set(nodeId, (selfMsById.get(nodeId) ?? 0) + deltaMs);
  });
  const nodesById = new Map<number, ProfileNode>(profile.nodes.map((node) => [node.id, node]));
  const costs = new Map<string, { selfMs: number; totalMs: number }>();
  const visit = (node: ProfileNode, keysOnStack: ReadonlySet<string>): number => {
    const isExtension: boolean = node.callFrame.url.startsWith(EXTENSION_URL_PREFIX);
    const key: string = keyOf(node);
    const stack: ReadonlySet<string> = isExtension ? new Set([...keysOnStack, key]) : keysOnStack;
    const selfMs: number = selfMsById.get(node.id) ?? 0;
    let totalMs: number = selfMs;
    for (const childId of node.children ?? []) {
      const child: ProfileNode | undefined = nodesById.get(childId);
      if (child !== undefined) totalMs += visit(child, stack);
    }
    if (isExtension) {
      const cost = costs.get(key) ?? { selfMs: 0, totalMs: 0 };
      cost.selfMs += selfMs;
      // A recursive frame's time is already counted at its outermost occurrence.
      if (!keysOnStack.has(key)) cost.totalMs += totalMs;
      costs.set(key, cost);
    }
    return totalMs;
  };
  const root: ProfileNode | undefined = profile.nodes[0];
  if (root !== undefined) visit(root, new Set());
  return [...costs].map(([key, cost]) => {
    const [name = "", location = ""] = key.split("\t");
    return { name, location, ...cost };
  });
}

export function profileReport(scene: string, costs: readonly FunctionCost[], limit = 25): string {
  const selfTotal: number = costs.reduce((sum, cost) => sum + cost.selfMs, 0);
  const row = (cost: FunctionCost): string =>
    `| ${cost.name} | ${cost.location} | ${cost.selfMs.toFixed(1)} | ${cost.totalMs.toFixed(1)} |`;
  const table = (sorted: FunctionCost[]): string[] => [
    "| Function | Location | Self (ms) | Total (ms) |",
    "| --- | --- | ---: | ---: |",
    ...sorted.slice(0, limit).map(row),
  ];
  return [
    `# CPU profile: ${scene}`,
    "",
    `Extension self time across all functions: ${selfTotal.toFixed(1)} ms.`,
    "",
    "## By self time",
    "",
    ...table([...costs].sort((left, right) => right.selfMs - left.selfMs)),
    "",
    "## By total time",
    "",
    ...table([...costs].sort((left, right) => right.totalMs - left.totalMs)),
    "",
  ].join("\n");
}
