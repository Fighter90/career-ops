import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingInbox } from "../../src/lib/inbox-pending.mjs";

test("pendingInbox drops done postings and repeated URLs", () => {
  const inbox = [
    { url: "https://jobs.example.test/a", done: false, role: "First" },
    { url: "https://jobs.example.test/b", done: true, role: "Done" },
    { url: "https://jobs.example.test/a", done: false, role: "Repeat" },
    { url: "https://jobs.example.test/c", done: false, role: "Third" },
  ];
  assert.deepEqual(pendingInbox(inbox).map((j) => j.role), ["First", "Third"]);
});
