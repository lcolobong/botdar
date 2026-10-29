/**
 * What Botdar leaves in a host page: its two shadow hosts and the attribute on each post whose
 * badge has mounted. Kept free of imports so the Node scripts (capture, smoke) and the snapshot
 * serializer's callers read the same names the content scripts write.
 */
export const BADGE_ELEMENT_NAME = "botdar-badge";
export const CARD_ELEMENT_NAME = "botdar-card";

/**
 * Set on a post once its badge mounts, so a later observer pass, or a script injected again after
 * an extension update, skips the post at selector level.
 */
export const BADGED_ATTRIBUTE = "data-botdar";

/** Appended to a post selector to match only posts that carry no badge yet. */
export const UNBADGED: string = `:not([${BADGED_ATTRIBUTE}])`;

/** Botdar's own markup, which a recorded snapshot must not keep. */
export interface OwnMarkup {
  hostElementNames: readonly string[];
  badgedAttribute: string;
}

export const OWN_MARKUP: OwnMarkup = {
  hostElementNames: [BADGE_ELEMENT_NAME, CARD_ELEMENT_NAME],
  badgedAttribute: BADGED_ATTRIBUTE,
};
