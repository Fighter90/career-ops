/**
 * Pending inbox postings, deduped by URL (pipeline.md can list the same
 * posting twice), so the header count, the tab count and the triage list
 * agree on one number.
 *
 * @template {{ url: string, done: boolean }} T
 * @param {T[]} inbox
 * @returns {T[]}
 */
export function pendingInbox(inbox) {
  const seen = new Set();
  const out = [];
  for (const j of inbox) {
    if (j.done || seen.has(j.url)) continue;
    seen.add(j.url);
    out.push(j);
  }
  return out;
}
