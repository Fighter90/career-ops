import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/web-ts-alias-loader.mjs";

const { dispatch } = await import("../../src/app/actions/registry.ts");

function context() {
  const started = [];
  const writes = [];
  return {
    started,
    writes,
    ctx: {
      push() {},
      replace() {},
      startJob(opts) {
        started.push(opts);
        return `job-${started.length}`;
      },
      inbox: [],
      applications: [{ n: "7", company: "Acme", role: "Engineer" }],
      jobForUrl() {},
      estimateCost() {
        return { tokens: 0, usd: 0 };
      },
      rememberFact() {},
      writeStatus(n, status) {
        writes.push([n, status]);
      },
      setApplyField() {},
      startApply() {},
    },
  };
}

test("generatePdf names the company for a zero-padded application number", () => {
  const { ctx, started } = context();
  dispatch("generatePdf", { n: "007" }, ctx);
  assert.equal(started[0].title, "CV PDF · Acme");
});

test("setStatus names the company and role for a zero-padded application number", () => {
  const { ctx, writes } = context();
  const result = dispatch("setStatus", { n: "007", status: "Applied" }, ctx);
  assert.equal(result.summary, "Mark Acme · Engineer → Applied?");
  result.run();
  assert.deepEqual(writes, [["007", "Applied"]]);
});

test("an unknown or non-numeric number falls back to the raw label", () => {
  const { ctx, started } = context();
  dispatch("generatePdf", { n: "99" }, ctx);
  dispatch("generatePdf", { n: "abc" }, ctx);
  dispatch("generatePdf", { n: "7abc" }, ctx);
  assert.deepEqual(started.map((s) => s.title), ["CV PDF · #99", "CV PDF · #abc", "CV PDF · #7abc"]);
});
