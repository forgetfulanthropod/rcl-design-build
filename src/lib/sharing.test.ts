import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHARING_DEFAULTS,
  SHARING_KEYS,
  companySharing,
  describeEffective,
  effectiveSnapshot,
  resolveSharing,
  snapshotAfterReview,
  snapshotHash,
} from "./sharing.ts";

test("resolveSharing: a missing company row is the coded default, all Off", () => {
  assert.deepEqual(resolveSharing(null, null), SHARING_DEFAULTS);
  assert.deepEqual(companySharing(undefined), { lead_budget_dollars: false, labor_doc_send: false });
  assert.deepEqual(SHARING_KEYS, ["lead_budget_dollars", "labor_doc_send"]);
});

test("resolveSharing: a project with null overrides inherits the company", () => {
  const company = { lead_budget_dollars: true, labor_doc_send: false };
  assert.deepEqual(resolveSharing(company, { review: "reviewed", values: { lead_budget_dollars: null, labor_doc_send: null } }), company);
  assert.deepEqual(resolveSharing(company, null), company);
});

test("resolveSharing: a project false beats a company true once reviewed", () => {
  const company = { lead_budget_dollars: true, labor_doc_send: true };
  const project = { review: "reviewed" as const, values: { lead_budget_dollars: false, labor_doc_send: null } };
  assert.deepEqual(resolveSharing(company, project), { lead_budget_dollars: false, labor_doc_send: true });
});

test("resolveSharing: a job still in review ignores its overrides (no leak before Mark reviewed)", () => {
  const project = { review: "needed" as const, values: { lead_budget_dollars: true, labor_doc_send: true } };
  assert.deepEqual(resolveSharing(null, project), SHARING_DEFAULTS);
  assert.deepEqual(resolveSharing({ labor_doc_send: true }, { review: "needed", values: { labor_doc_send: false } }), {
    lead_budget_dollars: false,
    labor_doc_send: true,
  });
});

test("snapshots carry value and source; the after-review snapshot applies overrides", () => {
  const values = { lead_budget_dollars: null, labor_doc_send: true };
  assert.deepEqual(effectiveSnapshot(null, { review: "needed", values }), {
    lead_budget_dollars: { value: false, source: "company" },
    labor_doc_send: { value: false, source: "company" },
  });
  const after = snapshotAfterReview(null, values);
  assert.deepEqual(after, {
    lead_budget_dollars: { value: false, source: "company" },
    labor_doc_send: { value: true, source: "project" },
  });
  assert.equal(describeEffective(after.labor_doc_send), "On · this job");
  assert.equal(describeEffective(after.lead_budget_dollars), "Off · company");
});

test("snapshotHash is stable and changes when any value or source changes", () => {
  const a = snapshotAfterReview(null, { labor_doc_send: true });
  const b = snapshotAfterReview(null, { labor_doc_send: true });
  assert.equal(snapshotHash(a), snapshotHash(b));
  assert.match(snapshotHash(a), /^[0-9a-f]{8}$/);
  assert.notEqual(snapshotHash(a), snapshotHash(snapshotAfterReview(null, { labor_doc_send: false })));
  assert.notEqual(snapshotHash(snapshotAfterReview({ labor_doc_send: true }, {})), snapshotHash(a)); // same value, other source
});
