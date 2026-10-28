import type { LabelStyle, RedditCommentLabels } from "@/src/core/settings";
import { Segmented } from "@/src/ui/controls/Segmented";
import type { SegmentedOption } from "@/src/ui/controls/Segmented";
import { Toggle } from "@/src/ui/controls/Toggle";
import type { SettingsSectionProps } from "./sectionProps";

const LABEL_STYLES: readonly SegmentedOption<LabelStyle>[] = [
  { value: "plain", label: "Plain" },
  { value: "sus", label: "Sus scale" },
  { value: "icon", label: "Icon only" },
];

const REDDIT_COMMENT_LABELS: readonly SegmentedOption<RedditCommentLabels>[] = [
  { value: "glyph", label: "Glyph only" },
  { value: "label", label: "Glyph and label" },
];

export function BadgesSection({ settings, update }: SettingsSectionProps) {
  return (
    <>
      <h2>Badges</h2>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Label style</p>
          <span class="bd-caption">
            Plain is the default. Sus scale swaps the words for internet lingo. Icon only drops the
            words.
          </span>
        </div>
        <Segmented
          label="Label style"
          options={LABEL_STYLES}
          value={settings.labelStyle}
          onChange={(labelStyle) => update({ labelStyle })}
        />
      </div>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Show Likely human</p>
          <span class="bd-caption">
            A green badge on accounts that look ordinary. Turn it off for a quieter feed that only
            marks accounts worth a look.
          </span>
        </div>
        <Toggle
          checked={settings.showLikelyHuman}
          label="Show Likely human"
          onChange={(showLikelyHuman) => update({ showLikelyHuman })}
        />
      </div>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Labels in Reddit comments</p>
          <span class="bd-caption">Glyph only keeps comment rows tidy.</span>
        </div>
        <Segmented
          label="Labels in Reddit comments"
          options={REDDIT_COMMENT_LABELS}
          value={settings.redditCommentLabels}
          onChange={(redditCommentLabels) => update({ redditCommentLabels })}
        />
      </div>
    </>
  );
}
