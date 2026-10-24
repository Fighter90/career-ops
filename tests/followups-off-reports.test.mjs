import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';

console.log('\nstats and funnel-velocity summaries while follow-ups are off');

const sandboxes = [];

function sandbox(followupsEnabled) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-followups-off-'));
  sandboxes.push(dir);
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'config'));
  const rows = Array.from({ length: 25 }, (_, i) =>
    `| ${i + 1} | 2026-08-01 | Company ${i + 1} | Data Analyst | 4.0/5 | Applied | ❌ | | Applied 2026-08-01 |`);
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...rows, '',
  ].join('\n'));
  writeFileSync(join(dir, 'data', 'follow-ups.md'), '# Follow-ups\n');
  writeFileSync(join(dir, 'config', 'profile.yml'), `follow_ups:\n  enabled: ${followupsEnabled}\n`);
  return dir;
}

function summary(script, dir) {
  const run = spawnSync(NODE, [join(ROOT, script), '--summary'], {
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PROFILE: '' },
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

try {
  assert.match(summary('funnel-velocity.mjs', sandbox(true)), /followup mode/);
  const off = summary('funnel-velocity.mjs', sandbox(false));
  assert.doesNotMatch(off, /follow-?up/i);
  assert.match(off, /beyond typical/);
  assert.match(off, /patterns mode/);
  pass('funnel-velocity points at followup mode only while follow-ups are on');
} catch (err) {
  fail(`funnel-velocity summary with follow-ups off: ${err.message}`);
}

try {
  assert.match(summary('stats.mjs', sandbox(true)), /Applied apps with none/);
  const off = summary('stats.mjs', sandbox(false));
  assert.doesNotMatch(off, /Applied apps with none/);
  assert.match(off, /Follow-ups: turned off/);
  pass('stats summary does not count Applied rows without a follow-up while follow-ups are off');
} catch (err) {
  fail(`stats summary with follow-ups off: ${err.message}`);
}

for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
