/** The vocabulary the smoke runner and its scene modules share: themes, groups, viewports and the manifest record. */
import type { SmokePlatformId } from "./sceneTable.ts";

export type SmokeTheme = "light" | "dark";
/** Where a served page came from; FixtureSource.kind in fixtureFiles.ts. */
export type FixtureKind = "recorded" | "placeholder" | "store";
export type SceneGroup = SmokePlatformId | "pages" | "store";

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface SceneRecord {
  readonly group: SceneGroup;
  readonly scene: string;
  readonly theme: SmokeTheme;
  readonly file: string;
  readonly status: "captured" | "skipped";
  readonly reason?: string;
  readonly fixture?: FixtureKind;
  /** The served page, relative to the repository root. */
  readonly fixtureFile?: string;
  /** The accessible name of the badge the hover scene hovered. */
  readonly hovered?: string;
  /** What the scene definition says to expect, e.g. a feed that draws nothing. */
  readonly note?: string;
}

export const feedViewport: Viewport = { width: 600, height: 820 };

export function screenshotName(group: SceneGroup, scene: string, theme: SmokeTheme): string {
  return `after-${group}-${scene}-${theme}.png`;
}
