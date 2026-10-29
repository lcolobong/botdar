import type { LabelStyle, RedditCommentLabels } from "@/src/core/settings";
import { Segmented } from "@/src/ui/controls/Segmented";
import type { SegmentedOption } from "@/src/ui/controls/Segmented";
import { Toggle } from "@/src/ui/controls/Toggle";
import type { SettingsSectionProps } from "./sectionProps";
import { SettingsRow } from "./SettingsRow";

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
      <SettingsRow
        title="Label style"
        caption={
          <>
            Plain is the default. Sus scale swaps the words for internet lingo. Icon only drops the
            words.
          </>
        }
      >
        <Segmented
          label="Label style"
          options={LABEL_STYLES}
          value={settings.labelStyle}
          onChange={(labelStyle) => update({ labelStyle })}
        />
      </SettingsRow>
      <SettingsRow
        title="Show Likely human"
        caption={
          <>
            A green badge on accounts that look ordinary. Turn it off for a quieter feed that only
            marks accounts worth a look.
          </>
        }
      >
        <Toggle
          checked={settings.showLikelyHuman}
          label="Show Likely human"
          onChange={(showLikelyHuman) => update({ showLikelyHuman })}
        />
      </SettingsRow>
      <SettingsRow title="Labels in Reddit comments" caption="Glyph only keeps comment rows tidy.">
        <Segmented
          label="Labels in Reddit comments"
          options={REDDIT_COMMENT_LABELS}
          value={settings.redditCommentLabels}
          onChange={(redditCommentLabels) => update({ redditCommentLabels })}
        />
      </SettingsRow>
    </>
  );
}
