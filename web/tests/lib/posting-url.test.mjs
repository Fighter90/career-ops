import assert from "node:assert/strict";
import test from "node:test";
import { postingHref, postingLabel, readTrackerUrl, resolvePostingUrl } from "../../src/lib/posting-url.mjs";

test("readTrackerUrl returns the href and leaves a non-link cell unchanged", () => {
  const workday = "https://jobs.example.com/Engineer_(Remote)";
  assert.equal(readTrackerUrl(`[workday](${workday})`), workday);
  assert.equal(readTrackerUrl("[board](<https://jobs.example.com/1>)"), "https://jobs.example.com/1");
  assert.equal(readTrackerUrl("https://jobs.example.com/1"), "https://jobs.example.com/1");
  assert.equal(readTrackerUrl("—"), "—");
  assert.equal(readTrackerUrl(""), "");
});

test("postingHref reads a markdown link and a raw URL", () => {
  assert.equal(postingHref("[greenhouse](https://boards.greenhouse.io/example/jobs/1)"), "https://boards.greenhouse.io/example/jobs/1");
  assert.equal(postingHref("https://jobs.example.com/1 extra"), "https://jobs.example.com/1");
  assert.equal(postingHref("—"), "");
  assert.equal(postingHref(""), "");
  assert.equal(postingHref("not a url"), "");
});

test("postingLabel uses the host without www", () => {
  assert.equal(postingLabel("https://www.example.com/jobs/1"), "example.com");
  assert.equal(postingLabel("not a url"), "posting");
});

test("resolvePostingUrl prefers the tracker cell", () => {
  assert.equal(
    resolvePostingUrl("https://jobs.example.com/tracker", "https://jobs.example.com/report"),
    "https://jobs.example.com/tracker",
  );
  assert.equal(resolvePostingUrl("—", "https://jobs.example.com/report"), "https://jobs.example.com/report");
  assert.equal(resolvePostingUrl("", ""), "");
});

test("readTrackerUrl keeps a value that is already a URL", () => {
  const nested = "https://jobs.example.com/[other](https://other.example.com)";
  assert.equal(readTrackerUrl(nested), nested);
  const once = readTrackerUrl(`[job](<${nested}>)`);
  assert.equal(once, nested);
  assert.equal(readTrackerUrl(once), nested);
});

test("postingHref does not reparse an extracted URL", () => {
  const nested = "https://jobs.example.com/[other](https://other.example.com)";
  assert.equal(postingHref(nested), nested);
});

test("postingHref keeps spaces inside a markdown destination", () => {
  assert.equal(
    postingHref("[job](https://jobs.example.com/Software\\ Engineer)"),
    "https://jobs.example.com/Software Engineer",
  );
  assert.equal(
    postingHref("[job](https://jobs.example.com/a_(Remote Role))"),
    "https://jobs.example.com/a_(Remote Role)",
  );
  assert.equal(postingHref("https://jobs.example.com/1 trailing note"), "https://jobs.example.com/1");
});
