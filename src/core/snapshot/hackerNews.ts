/**
 * Hacker News anonymisation, kept apart because it differs from the other platforms in two ways.
 * Usernames are case-sensitive ("Foo" and "foo" are two accounts) and can be two characters long,
 * so a page-wide search for every handle would merge accounts and, for a user called "td" or "by",
 * rewrite tags, attributes and prose. Handles are therefore replaced only where the site renders
 * them: the `id` of a profile link, the `hnuser` link text, the user page's `birth=` link and
 * title, and a host label or path segment of a link to the account's own site. Other text is
 * prose and is left alone, as on every platform.
 */

const HANDLE = "[A-Za-z0-9_-]{2,15}";
/** Pages that take a username as their `id` query parameter. */
export const USER_PAGES = "(?:user|threads|submitted|favorites)";
const USER_PAGE_PATH = new RegExp(`^/${USER_PAGES}$`);

/**
 * Each pattern captures the text before the handle, the handle, and what follows it, so a
 * replacement keeps everything around the handle exactly as recorded.
 */
const RENDERED_HANDLE_PATTERNS: readonly RegExp[] = [
  new RegExp(`(${USER_PAGES}\\?id=)(${HANDLE})([&"'#])`, "g"),
  // A new account's name is wrapped in a green <font>, per docs/research/platforms.md.
  new RegExp(`(class="hnuser">(?:<font[^>]*>)?)(${HANDLE})(<)`, "g"),
  new RegExp(`([?&;]birth=)(${HANDLE})([&"'])`, "g"),
  new RegExp(`(<title>(?:Profile: )?)(${HANDLE})((?:'s [a-z]+)? \\|)`, "g"),
  // A story that links to a site named after its author ("from?site=<name>.com").
  new RegExp(`(from\\?site=|class="sitestr">)(${HANDLE})([./"<])`, "g"),
];

/** The usernames the page renders as accounts: profile links and `hnuser` text. */
export function hackerNewsHandles(html: string): Set<string> {
  const handles: Set<string> = new Set();
  for (const pattern of RENDERED_HANDLE_PATTERNS.slice(0, 2)) {
    for (const match of html.matchAll(pattern)) {
      const handle: string | undefined = match[2];
      if (handle !== undefined) handles.add(handle);
    }
  }
  return handles;
}

/** Shorter names are too likely to be an ordinary path segment or file extension. */
const MIN_URL_HANDLE_LENGTH = 3;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A story or comment that links to the author's own site or repository (`blog.<name>.com`,
 * `github.com/<name>`) would tie the fake to the real account, so a known handle is also replaced
 * where it is a host label or path segment: after a "/" or "." that does not open a closing tag.
 */
function urlEmbeddedPattern(handles: Iterable<string>): RegExp | undefined {
  const alternation: string = [...handles]
    .filter((handle) => handle.length >= MIN_URL_HANDLE_LENGTH)
    .sort((first, second) => second.length - first.length)
    .map(escapeRegExp)
    .join("|");
  return alternation === ""
    ? undefined
    : new RegExp(`(?<=(?<!<)[/.])(${alternation})(?![A-Za-z0-9_-])`, "g");
}

/** Replaces each rendered handle by its fake, matching case exactly; reports each replacement. */
export function replaceHackerNewsHandles(
  html: string,
  fakes: ReadonlyMap<string, string>,
  onReplace: (handle: string) => void,
): string {
  let output: string = html;
  const fakeOf = (match: string, handle: string, rebuild: (fake: string) => string): string => {
    const fake: string | undefined = fakes.get(handle);
    if (fake === undefined) return match;
    onReplace(handle);
    return rebuild(fake);
  };
  for (const pattern of RENDERED_HANDLE_PATTERNS) {
    output = output.replace(pattern, (match, before: string, handle: string, after: string) =>
      fakeOf(match, handle, (fake) => `${before}${fake}${after}`),
    );
  }
  const embedded: RegExp | undefined = urlEmbeddedPattern(fakes.keys());
  if (embedded !== undefined) {
    output = output.replace(embedded, (match, handle: string) =>
      fakeOf(match, handle, (fake) => fake),
    );
  }
  return output;
}

export interface HackerNewsIdSubstitution {
  pattern: RegExp;
  replacement: (match: string, ...groups: string[]) => string;
}

/** Item ids and the reply form's hmac; `fakeNumeric` decides how an id is replaced. */
export function hackerNewsIdSubstitutions(
  fakeNumeric: (id: string) => string,
): HackerNewsIdSubstitution[] {
  return [
    {
      // Item ids sit in `id="…"` rows, `?id=` links, `up_`/`score_`/`unv_` element ids, `#…`
      // fragments (`href="#…"` included), URL-encoded `goto=` values and the reply form's
      // `parent` field. A `#` that opens a colour (`color="#828282"`, `color:#828282`) is not an
      // item fragment, even when the colour happens to be all digits.
      pattern: /(?<=[?&;]id=|\bid=["']|_|(?<!color=["']|color:)#|%3D|%23|value=")(\d{6,10})(?!\d)/g,
      replacement: (_match, id) => fakeNumeric(id),
    },
    {
      pattern: /(name="hmac" value=")[0-9a-f]+/g,
      replacement: (_match, prefix) => `${prefix}${"0".repeat(40)}`,
    },
  ];
}

/**
 * Hacker News names the account or the item in the `id` query parameter (`user?id=<name>`,
 * `item?id=<n>`), so a recorded address keeps that one parameter, replaced.
 */
export function anonymizeHackerNewsUrl(
  parsed: URL,
  fakeHandle: (handle: string) => string,
  fakeNumeric: (id: string) => string,
): string {
  const id: string | null = parsed.searchParams.get("id");
  const base = `${parsed.origin}${parsed.pathname}`;
  if (id === null) return base;
  return `${base}?id=${USER_PAGE_PATH.test(parsed.pathname) ? fakeHandle(id) : fakeNumeric(id)}`;
}
