/**
 * Functional test: the /workspace page must render a malicious username as
 * inert text (no stored XSS).
 *
 * `getUserWorkspaceHtml` is the exact function the `/workspace` route sends to
 * the browser (src/server/routes/dashboard.ts), so rendering it here exercises
 * the same server-side path a victim's browser would receive.
 *
 * Run: npx tsx test-workspace-xss.ts
 */
import { getUserWorkspaceHtml } from "./src/dashboard/workspace.js";

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures += 1;
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Extract the text between two markers (first occurrence). */
function between(html: string, start: string, end: string): string | null {
  const from = html.indexOf(start);
  if (from === -1) return null;
  const to = html.indexOf(end, from + start.length);
  if (to === -1) return null;
  return html.slice(from + start.length, to);
}

const SPAN_OPEN = '<span id="display-username">';
const H1_PREFIX = "Welcome, ";
const H1_SUFFIX = "!</h1>";

// Baseline: how many <script tags the page legitimately contains (its own JS).
const baseline = getUserWorkspaceHtml("alice");

console.log("1. Legitimate usernames render unchanged");
check("plain username appears in the span", baseline.includes(`${SPAN_OPEN}alice</span>`));
check("plain username appears in the h1", baseline.includes(`${H1_PREFIX}alice${H1_SUFFIX}`));

console.log("2. <script> payload is escaped, not executable");
const payload = ["<", "script>alert('XSS')</", "script>"].join("");
const xss = getUserWorkspaceHtml(payload);

check(
  "raw script payload is absent from the page",
  count(xss, payload) === 0,
  "payload appeared verbatim"
);
check(
  "payload is present only as escaped entities",
  xss.includes("&lt;script&gt;alert(&#39;XSS&#39;)&lt;/script&gt;")
);
const scriptTag = "<" + "script";
const baselineCount = count(baseline, scriptTag);
const renderedCount = count(xss, scriptTag);
check(
  "no new <script tag was introduced by the username",
  renderedCount === baselineCount,
  `baseline=${baselineCount} rendered=${renderedCount}`
);

console.log("3. Username regions cannot open a tag");
const spanText = between(xss, SPAN_OPEN, "</span>");
const h1Text = between(xss, H1_PREFIX, H1_SUFFIX);
check("display-username region was found", spanText !== null);
check("h1 username region was found", h1Text !== null);
check(
  "display-username region contains no raw < or >",
  spanText !== null && !/[<>]/.test(spanText),
  spanText ?? "region missing"
);
check(
  "h1 region contains no raw < or >",
  h1Text !== null && !/[<>]/.test(h1Text),
  h1Text ?? "region missing"
);

console.log("4. Attribute-breakout payload is neutralised");
const attrPayload = '"><img src=x onerror=alert(1)>';
const attr = getUserWorkspaceHtml(attrPayload);
check("no injected <img element", !attr.includes("<img"));
// The handler text survives as literal characters, which is inert; what matters
// is that no tag/attribute can form around it. Escaping keeps the whole payload
// as a single text blob, so this exact escaped form must be present verbatim.
check(
  "attribute payload is rendered as inert escaped text",
  attr.includes("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;")
);
const attrRegion = between(attr, SPAN_OPEN, "</span>");
check(
  "attribute payload region contains no raw < or >",
  attrRegion !== null && !/[<>]/.test(attrRegion),
  attrRegion ?? "region missing"
);
check(
  "quotes in the payload are encoded",
  attr.includes("&quot;&gt;&lt;img")
);

console.log("5. Other metacharacters in a username are encoded");
const amp = getUserWorkspaceHtml("a&b<c>d");
check("ampersand encoded", amp.includes("a&amp;b"));
check("angle brackets encoded", amp.includes("&lt;c&gt;d"));

console.log("6. Negative control: the checks detect an unescaped render");
// Reproduce the pre-fix shape (raw interpolation) and confirm our detector
// flags it, proving the assertions above are sensitive to the vulnerability.
const unescapedBase = `<span id="display-username">alice</span>`;
const unescaped = `<span id="display-username">${payload}</span>`;
const unescapedRegion = between(unescaped, SPAN_OPEN, "</span>");
check("unescaped control contains the raw payload", unescaped.includes(payload));
check(
  "unescaped control is flagged by the tag-opening check",
  unescapedRegion !== null && /[<>]/.test(unescapedRegion)
);
check(
  "unescaped control adds a <script tag vs the safe control",
  count(unescaped, "<script") > count(unescapedBase, "<script")
);

if (failures > 0) {
  console.error(`\n\u274c ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\n\u2705 All workspace XSS escaping assertions passed.");
