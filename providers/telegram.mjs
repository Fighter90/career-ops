// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Telegram provider — reads a PUBLIC channel's web preview at
// `https://t.me/s/<channel>`. Wire in via a `job_boards:` entry with
// `provider: telegram` and `channel: <handle>`.
//
// WHY THIS SHAPE. Telegram publishes no RSS, and the Bot API cannot read a
// channel a bot does not administer — so neither of the obvious routes works
// for someone else's job channel. What IS public is the `/s/` preview: plain
// server-rendered HTML over HTTPS, no auth, no JS, no cookie. Measured
// 2026-08-29 across 16 Russian-language job channels: 15 returned 20 posts
// each on a bare GET; the sixteenth answered 302, which is how t.me responds
// for a channel that is private or absent — hence the explicit throw below
// rather than a silent empty result.
//
// PARSING CONTRACT. Markup rots, so the anchors are the things a Telegram
// redesign is least likely to move, all semantic rather than cosmetic:
//
//   1. `data-post="<channel>/<id>"` — both splits the page into per-post
//      windows AND carries the permalink, the only stable URL a post has;
//   2. `<div class="tgme_widget_message_text">` — the body;
//   3. `<time datetime="…">` — an ISO timestamp, not a localized "2h ago".
//
// WHAT A POST IS NOT. Every other provider here reads a structured job record.
// A channel post is free prose written by a human, and a job channel also
// carries ads, digests and chatter. So this provider does NOT pretend to
// extract a clean vacancy: it lifts a title from the first substantive line,
// reads company/location only from patterns that NAME the field, and leaves the
// rest in `description`. Separating real postings from noise is the scanner's
// existing `title_filter` — the same one already tuned for other boards — so a
// channel that is half ads costs precision, not correctness. These are leads,
// not listings.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const TRUSTED_HOST = 't.me';

/** Default cap per channel. The preview page itself serves ~20 posts. */
const DEFAULT_MAX_POSTS = 100;

/** Hard ceiling on a configured `max_posts`, so one entry cannot sweep forever. */
const MAX_POSTS_CAP = 300;

/** A channel handle: what Telegram itself allows, nothing more. */
const CHANNEL_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/** Post windows open at the permalink attribute; each runs to the next one. */
const POST_ANCHOR_RE = /data-post="([^"/]+)\/(\d+)"/g;

/** The message body container. */
const BODY_RE = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/;

/** ISO publication timestamp. */
const TIME_RE = /<time[^>]+datetime="([^"]+)"/;

// Deliberately conservative: a wrong employer is worse than none, because it
// enters the tracker as fact. Only patterns that name the field outright.
const COMPANY_RE = /(?:^|\n)\s*(?:компания|company|работодатель|employer)\s*[:\-–—]\s*([^\n]{2,60})/iu;
const LOCATION_RE = /(?:^|\n)\s*(?:локация|город|location|office|формат)\s*[:\-–—]\s*([^\n]{2,60})/iu;

// Unicode-aware left boundary, NOT `\b`: `\b` is ASCII-only, so the space
// before a Cyrillic word is not a boundary at all and `\bудал` never matches
// "Go dev, удалёнка".
const REMOTE_RE = /(?<![\p{L}\p{M}\p{N}_])(?:remote|удал[её]н|from\s+home|релокац)/iu;

/**
 * Validate a t.me URL. HTTPS-only, host pinned to `t.me` EXACTLY — a subdomain
 * or lookalike (`t.me.evil.test`) must not pass, which an `endsWith` check
 * would allow.
 * @param {string} url
 */
export function assertTelegramUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`telegram: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`telegram: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`telegram: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/**
 * Normalize whatever the user wrote in `channel:` to a bare handle. People
 * paste the full link far more often than the handle, so accept
 * `https://t.me/name`, `t.me/name`, `@name` and `name` alike rather than
 * failing on the most natural thing to type.
 * @param {unknown} raw
 * @returns {string} the handle, or '' when it cannot be read as one
 */
export function normalizeChannel(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '').replace(/^s\//i, '').replace(/^@/, '');
  s = s.split(/[/?#]/)[0].trim();
  return CHANNEL_RE.test(s) ? s : '';
}

/**
 * Build the preview URL for a `job_boards` entry.
 * @param {{channel?: unknown, telegram?: unknown, name?: unknown}} [entry]
 */
export function buildChannelUrl(entry) {
  const handle = normalizeChannel(entry?.channel ?? entry?.telegram ?? entry?.name);
  if (!handle) throw new Error('telegram: no usable channel handle (set `channel:` to e.g. rabotaphp)');
  return `https://t.me/s/${handle}`;
}

/**
 * Collapse a message fragment to its visible text, preserving line structure —
 * the line breaks are what the title and the labelled fields are read from.
 *
 * Two things a one-line `replace(/<[^>]+>/g, '')` gets wrong here:
 *
 *   1. it eats real text. A post reading "зарплата < 300k, опыт > 3 лет" has
 *      `< 300k, опыт >` matched as a tag and deleted. Requiring a letter after
 *      the `<` keeps prose intact and still catches every real tag;
 *   2. it is an incomplete sanitizer — removing `<b>` from `<<b>script>`
 *      re-forms `<script>` out of the text on either side, so the strip runs
 *      to a fixed point rather than once.
 *
 * The loop is bounded: each pass strictly shortens the string, but an
 * adversarial `<<<<<a>>>>>` could cost a pass per character. Eight clear any
 * nesting real markup produces.
 *
 * @param {string} fragment
 * @returns {string}
 */
export function visibleText(fragment) {
  const finish = (text) => decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let s = String(fragment ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n');

  for (let i = 0; i < 8; i++) {
    const next = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
    if (next === s) return finish(s);
    s = next;
  }
  return finish(s.replace(/<\/?[a-zA-Z][^>]*>/g, ''));
}

/**
 * The post's title: its first line that reads like a heading rather than a
 * greeting or an emoji divider. Job posts overwhelmingly lead with the role,
 * which is why the first substantive line beats any keyword heuristic here.
 * @param {string} text
 * @returns {string}
 */
export function titleFromText(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip pure-emoji / punctuation dividers and one-word interjections.
    const letters = line.replace(/[^\p{L}\p{N}]/gu, '');
    if (letters.length < 4) continue;
    return line.replace(/^[#>*\-–—•·\s]+/, '').slice(0, 160).trim();
  }
  return '';
}

/**
 * Parse one `/s/` preview page into postings.
 *
 * Windows are cut on `data-post` rather than on any layout container: the
 * attribute is what Telegram needs to build permalinks, so it survives
 * restyling in a way a CSS class does not.
 *
 * @param {string} html - Raw preview page.
 * @returns {{title: string, url: string, company: string, location: string, description: string, postedAt?: number}[]}
 */
export function parseChannelPage(html) {
  const src = String(html ?? '');
  POST_ANCHOR_RE.lastIndex = 0;

  const anchors = [...src.matchAll(POST_ANCHOR_RE)];
  /** @type {{title: string, url: string, company: string, location: string, description: string, postedAt?: number}[]} */
  const out = [];
  const seen = new Set();

  for (let i = 0; i < anchors.length; i++) {
    const [, chan, id] = anchors[i];
    const key = `${chan}/${id}`;
    if (seen.has(key)) continue;                     // the page repeats an anchor per post
    const start = anchors[i].index ?? 0;
    const end = i + 1 < anchors.length ? (anchors[i + 1].index ?? src.length) : src.length;
    const win = src.slice(start, end);

    const bodyMatch = BODY_RE.exec(win);
    if (!bodyMatch) continue;                        // service message / media-only post
    const description = visibleText(bodyMatch[1]);
    const title = titleFromText(description);
    if (!title) continue;                            // nothing a human could read as a role

    seen.add(key);

    const timeMatch = TIME_RE.exec(win);
    const posted = timeMatch ? Date.parse(timeMatch[1]) : NaN;
    const company = (COMPANY_RE.exec(description)?.[1] ?? '').trim();
    const location = (LOCATION_RE.exec(description)?.[1] ?? '').trim();

    out.push({
      title,
      url: `https://t.me/${chan}/${id}`,
      // With no labelled employer, the channel is the honest attribution —
      // never a guess lifted out of the prose.
      company: company || `@${chan}`,
      location: location || (REMOTE_RE.test(description) ? 'Remote' : ''),
      description,
      ...(Number.isFinite(posted) ? { postedAt: posted } : {}),
    });
  }

  return out;
}

/** @type {Provider} */
export default {
  id: 'telegram',

  detect(entry) {
    return entry?.provider === 'telegram' ? { url: buildChannelUrl(entry) } : null;
  },

  async fetch(entry, ctx) {
    const url = assertTelegramUrl(buildChannelUrl(entry));

    const html = await fetchTextWithRetry(ctx, url, {
      headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT },
      redirect: 'error',
    });

    const posts = parseChannelPage(html);

    // A public channel always renders posts. Zero means the handle is wrong,
    // the channel is private, or t.me redirected — all worth surfacing,
    // because a silent empty result reads as "no vacancies today" and would
    // hide a typo in portals.yml forever.
    if (posts.length === 0) {
      throw new Error(
        `telegram: no posts parsed from ${url} — the channel may be private, empty or misspelled`,
      );
    }

    const entryMax = Number.isInteger(entry?.max_posts) && entry.max_posts > 0
      ? Math.min(entry.max_posts, MAX_POSTS_CAP)
      : DEFAULT_MAX_POSTS;

    return posts.slice(0, entryMax);
  },
};
