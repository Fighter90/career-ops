// tests/providers/telegram.test.mjs — provider-contract tests for the Telegram
// public-channel preview reader (providers/telegram.mjs).
//
// The fixtures reproduce shapes measured on live t.me/s/ pages on 2026-08-29,
// and each one exists because it decides the provider's design:
//
//   - posts are delimited by `data-post="<channel>/<id>"`, the attribute
//     Telegram needs for permalinks and therefore the anchor a redesign is
//     least likely to drop;
//   - the body sits in `tgme_widget_message_text` and the date in an ISO
//     `<time datetime>` — never a localized "2 hours ago";
//   - a post is PROSE. There are no structured fields, so company and location
//     are read only from patterns that NAME them, and an unlabelled post is
//     attributed to the channel rather than to a name guessed out of the text;
//   - a service/media-only post has no body and must be skipped, not emitted
//     as a titleless job.
//
// Two groups matter more than the parsing:
//
//   - the host pin is an EXACT `t.me` match, so `t.me.evil.test` — which an
//     endsWith check would accept — is rejected;
//   - a page that parses to nothing THROWS. Returning [] would render a private
//     or misspelled channel as a channel with no vacancies, which is the exact
//     failure that makes a scraper untrustworthy.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — telegram');

// A full post: labelled company and location, an ISO date, entities in the body.
const POST_FULL = `
<div class="tgme_widget_message js-widget_message" data-post="rabotaphp/1240">
  <div class="tgme_widget_message_text js-message_text" dir="auto">Senior PHP Developer (Laravel)<br/>
Компания: Acme &amp; Co<br/>
Локация: Москва<br/>
Вилка: от 300 000 ₽</div>
  <div class="tgme_widget_message_footer">
    <a class="tgme_widget_message_date" href="https://t.me/rabotaphp/1240">
      <time datetime="2026-08-28T09:15:04+00:00">Aug 28</time></a>
  </div>
</div>`;

// A minimal post: no labels at all, and a leading emoji divider line that must
// not become the title.
const POST_MINIMAL = `
<div class="tgme_widget_message js-widget_message" data-post="rabotaphp/1241">
  <div class="tgme_widget_message_text js-message_text" dir="auto">🔥🔥🔥<br/>
Go разработчик, удалёнка<br/>
Пишите в личку</div>
  <div class="tgme_widget_message_footer">
    <a class="tgme_widget_message_date" href="https://t.me/rabotaphp/1241">
      <time datetime="2026-08-27T18:00:00+00:00">Aug 27</time></a>
  </div>
</div>`;

// A media-only/service post: an anchor but no text container.
const POST_MEDIA = `
<div class="tgme_widget_message js-widget_message" data-post="rabotaphp/1242">
  <a class="tgme_widget_message_photo_wrap" href="https://t.me/rabotaphp/1242"></a>
</div>`;

const PAGE = `<html><body><section class="tgme_channel_history">${POST_FULL}${POST_MINIMAL}${POST_MEDIA}</section></body></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/telegram.mjs')).href);
  const telegram = mod.default;
  const { parseChannelPage, buildChannelUrl, normalizeChannel, visibleText, titleFromText, assertTelegramUrl } = mod;

  if (telegram.id === 'telegram') pass('telegram.id is "telegram"');
  else fail(`telegram.id is ${JSON.stringify(telegram.id)}`);

  // ── detect(): explicit selection only, like every board-wide provider ──
  const hit = telegram.detect({ name: 'PHP jobs', provider: 'telegram', channel: 'rabotaphp' });
  if (hit && hit.url === 'https://t.me/s/rabotaphp') {
    pass('detect() resolves provider:telegram → the /s/ preview URL');
  } else {
    fail(`detect() returned ${JSON.stringify(hit)}`);
  }
  if (telegram.detect({ name: 'PHP jobs', channel: 'rabotaphp' }) === null) {
    pass('detect() returns null without provider:telegram');
  } else {
    fail('detect() must require provider:telegram');
  }

  // ── normalizeChannel(): every way a person writes a channel ──
  const forms = ['rabotaphp', '@rabotaphp', 't.me/rabotaphp', 'https://t.me/rabotaphp',
                 'https://t.me/s/rabotaphp', 'https://t.me/rabotaphp/1240'];
  const normalized = forms.map(normalizeChannel);
  if (normalized.every((h) => h === 'rabotaphp')) {
    pass('normalizeChannel() accepts handle, @handle, bare and full t.me links, and a post link');
  } else {
    fail(`normalizeChannel drift: ${JSON.stringify(normalized)}`);
  }
  // Anything Telegram itself would not allow as a handle is rejected outright,
  // so a malformed value can never be interpolated into the request path.
  const rejected = ['', '  ', 'ab', '1channel', 'has-dash', 'спам', '../etc/passwd', 'a'.repeat(40)];
  if (rejected.every((r) => normalizeChannel(r) === '')) {
    pass('normalizeChannel() rejects anything Telegram would not accept as a handle');
  } else {
    fail(`normalizeChannel accepted a bad handle: ${JSON.stringify(rejected.map(normalizeChannel))}`);
  }
  let threwNoHandle = false;
  try { buildChannelUrl({ provider: 'telegram' }); } catch { threwNoHandle = true; }
  if (threwNoHandle) pass('buildChannelUrl() throws when no usable handle is configured');
  else fail('a missing channel handle must fail loudly, not build a bare t.me URL');

  // ── assertTelegramUrl(): the host pin is EXACT ──
  let pinned = true;
  for (const bad of ['https://t.me.evil.test/s/x', 'https://not-t.me/s/x', 'http://t.me/s/x', 'https://evil.test/t.me/s/x']) {
    let threw = false;
    try { assertTelegramUrl(bad); } catch { threw = true; }
    if (!threw) { pinned = false; fail(`assertTelegramUrl() accepted ${bad}`); }
  }
  if (pinned) pass('assertTelegramUrl() pins the host to t.me exactly and requires HTTPS');
  if (assertTelegramUrl('https://t.me/s/rabotaphp') === 'https://t.me/s/rabotaphp') {
    pass('assertTelegramUrl() passes a legitimate preview URL through');
  } else {
    fail('a valid t.me preview URL must pass');
  }

  // ── visibleText() / titleFromText() ──
  if (visibleText('Role <!-- ad --> <b>Dev</b><br/>Next') === 'Role Dev\nNext') {
    pass('visibleText() drops comments and tags but keeps the line breaks the fields rely on');
  } else {
    fail(`visibleText() => ${JSON.stringify(visibleText('Role <!-- ad --> <b>Dev</b><br/>Next'))}`);
  }
  // A one-pass /<[^>]+>/g would delete everything between the two brackets and
  // take the salary range with it — prose in a channel post is full of them.
  const prose = 'зарплата < 300k, опыт > 3 лет';
  if (visibleText(prose) === prose) {
    pass('visibleText() keeps prose that merely looks like markup (< 300k … > 3 лет)');
  } else {
    fail(`prose eaten: ${JSON.stringify(visibleText(prose))}`);
  }
  // Removing the inner <b> from `<<b>script>` re-forms `<script>`, so the strip
  // must run to a fixed point rather than once.
  if (visibleText('<<b>script>alert(1)<<b>/script>') === 'alert(1)'
      && visibleText('a<<b>img src=x onerror=1>b') === 'ab'
      && !/<\/?[a-zA-Z]/.test(visibleText('<'.repeat(40) + 'a' + '>'.repeat(40)))) {
    pass('visibleText() strips to a fixed point — a tag cannot be reassembled');
  } else {
    fail(`reassembly: ${JSON.stringify(visibleText('<<b>script>alert(1)<<b>/script>'))}`);
  }
  // Deep nesting needs more passes than the loop allows — each pass strips only
  // the innermost tag. The fallback must not leave a reassembled tag behind.
  let deep = 'script>alert(1)';
  for (let i = 0; i < 12; i++) deep = '<a' + deep;
  const exhausted = visibleText(deep);
  if (!exhausted.includes('<') && exhausted === 'alert(1)') {
    pass('the bounded fallback emits no `<` at all — nesting cannot outrun it');
  } else {
    fail(`fallback drift: ${JSON.stringify(exhausted)}`);
  }
  if (titleFromText('🔥🔥🔥\n✨\nGo разработчик, удалёнка\nПишите') === 'Go разработчик, удалёнка') {
    pass('titleFromText() skips emoji dividers and takes the first substantive line');
  } else {
    fail(`titleFromText drift: ${JSON.stringify(titleFromText('🔥🔥🔥\n✨\nGo разработчик, удалёнка\nПишите'))}`);
  }
  if (titleFromText('🔥\n👍\n') === '') {
    pass('a post with no substantive line yields no title rather than an emoji one');
  } else {
    fail('an emoji-only post must not produce a title');
  }

  // ── parseChannelPage(): the shapes t.me actually serves ──
  const jobs = parseChannelPage(PAGE);
  if (jobs.length === 2) pass('parseChannelPage() returns one job per post, skipping the media-only post');
  else fail(`parseChannelPage() returned ${jobs.length}: ${JSON.stringify(jobs)}`);

  const full = jobs.find((j) => j.url.endsWith('/1240'));
  if (full && full.title === 'Senior PHP Developer (Laravel)') {
    pass('title comes from the post’s first substantive line');
  } else {
    fail(`title drift: ${JSON.stringify(full && full.title)}`);
  }
  if (full && full.url === 'https://t.me/rabotaphp/1240') {
    pass('url is the post permalink built from the data-post attribute');
  } else {
    fail(`url drift: ${JSON.stringify(full && full.url)}`);
  }
  if (full && full.company === 'Acme & Co') {
    pass('company is read from an explicit "Компания:" label, entities decoded once');
  } else {
    fail(`company drift: ${JSON.stringify(full && full.company)}`);
  }
  if (full && full.location === 'Москва') {
    pass('location is read from an explicit "Локация:" label');
  } else {
    fail(`location drift: ${JSON.stringify(full && full.location)}`);
  }
  if (full && full.postedAt === Date.parse('2026-08-28T09:15:04+00:00')) {
    pass('postedAt comes from the ISO <time datetime>, not a localized label');
  } else {
    fail(`postedAt drift: ${String(full && full.postedAt)}`);
  }

  const minimal = jobs.find((j) => j.url.endsWith('/1241'));
  // The unlabelled post is the one that decides the whole design: a wrong
  // employer would enter the tracker as a fact, so the channel is the answer.
  if (minimal && minimal.company === '@rabotaphp') {
    pass('an unlabelled post is attributed to the channel — the company is never guessed');
  } else {
    fail(`company guess leaked: ${JSON.stringify(minimal && minimal.company)}`);
  }
  // "удалёнка" is the case that `\b` cannot match: `\b` is ASCII-only, so the
  // space before a Cyrillic word is not a word boundary at all.
  if (minimal && minimal.location === 'Remote') {
    pass('remote detection matches Cyrillic "удалёнка" (a Unicode boundary, not \\b)');
  } else {
    fail(`remote drift: ${JSON.stringify(minimal && minimal.location)}`);
  }
  // Fields the minimal post lacks must be empty or channel-derived — never
  // inherited from the richer post above it in the page.
  if (minimal && minimal.description.includes('Go разработчик') && !minimal.description.includes('Acme')) {
    pass('post windows do not leak text across neighbouring posts');
  } else {
    fail(`cross-post leak: ${JSON.stringify(minimal && minimal.description)}`);
  }

  // ── The silent-zero guard, via the provider's own fetch() ──
  // fetchTextWithRetry(ctx, url, opts) calls ctx.fetchText(url, opts), so a ctx
  // with a stub fetchText exercises the real fetch() path without a network hop.
  const makeCtx = (html) => ({ async fetchText() { return html; } });
  const okJobs = await telegram.fetch(
    { provider: 'telegram', channel: 'rabotaphp' },
    makeCtx(PAGE),
  );
  if (okJobs.length === 2) pass('fetch() returns the parsed posts for a healthy channel');
  else fail(`fetch() returned ${okJobs.length}: ${JSON.stringify(okJobs)}`);

  let threwEmpty = false;
  try {
    await telegram.fetch(
      { provider: 'telegram', channel: 'jobgeeks' },
      makeCtx('<html><body>Preview unavailable</body></html>'),
    );
  } catch {
    threwEmpty = true;
  }
  if (threwEmpty) {
    pass('a page that parses to nothing throws — a private channel must not read as "no vacancies"');
  } else {
    fail('an unparsed preview page must fail loudly, not return []');
  }

  // max_posts caps the slice, and a configured value above the hard cap is clamped.
  const many = `<html><body>${Array.from({ length: 5 }, (_, i) => POST_FULL.replace(/1240/g, String(2000 + i))).join('')}</body></html>`;
  const capped = await telegram.fetch(
    { provider: 'telegram', channel: 'rabotaphp', max_posts: 2 },
    makeCtx(many),
  );
  if (capped.length === 2) pass('max_posts caps how many posts one entry contributes');
  else fail(`max_posts drift: got ${capped.length}`);
} catch (err) {
  fail(`telegram provider tests threw: ${err && err.stack ? err.stack : err}`);
}
