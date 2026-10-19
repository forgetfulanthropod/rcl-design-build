import { test } from "node:test";
import assert from "node:assert/strict";
import { documentSubject, gmailComposeUrl, statusAfterReply, statusAfterSend, visibleSections } from "./documents.ts";

test("sending a draft advances it, and a later send does not", () => {
  assert.equal(statusAfterSend("rfi", "Open"), "Sent");
  assert.equal(statusAfterSend("rfi", "Answered"), "Answered");
  assert.equal(statusAfterSend("change_order", "Draft"), "Submitted");
  assert.equal(statusAfterSend("policy", "Draft"), "In effect");
  assert.equal(statusAfterSend("invoice", "Draft"), "Sent");
  assert.equal(statusAfterSend("bid", "Awarded"), "Awarded");
});

test("a reply answers an RFI and never approves a change order", () => {
  assert.equal(statusAfterReply("rfi", "Sent"), "Answered");
  assert.equal(statusAfterReply("bid", "Sent"), "Received");
  assert.equal(statusAfterReply("submittal", "Sent"), "Revise");
  assert.equal(statusAfterReply("change_order", "Submitted"), "Submitted");
  assert.equal(statusAfterReply("invoice", "Sent"), "Sent");
});

test("labor and leads do not get bids or invoices", () => {
  const field = visibleSections(false).map((section) => section.id);
  const office = visibleSections(true).map((section) => section.id);
  assert.deepEqual(field, ["policy", "changes"]);
  assert.deepEqual(office, ["policy", "bids", "invoices", "changes"]);
});

test("gmail compose url carries the document subject", () => {
  const url = gmailComposeUrl("a@b.co", documentSubject("rfi", 4, "Pocket door"), "See attached.");
  assert.match(url, /^https:\/\/mail\.google\.com\/mail\/\?/);
  assert.match(url, /RFI\+004/);
  assert.match(url, /to=a%40b\.co/);
});

import { SECTION_EMPTY, createdMessage, docFormFields, newDocumentId } from "./documents.ts";

test("docs cleanup (F4): section empty states say what's missing", () => {
  assert.equal(SECTION_EMPTY.policy, "No policies yet.");
  assert.equal(SECTION_EMPTY.changes, "No RFIs, submittals or change orders yet.");
});

test("docs cleanup (F4): policy has no recipient; amount only for money roles on bid/invoice/CO", () => {
  assert.deepEqual(docFormFields("policy", true), { recipient: false, amount: false });
  assert.deepEqual(docFormFields("rfi", true), { recipient: true, amount: false });
  for (const kind of ["bid", "invoice", "change_order"] as const) {
    assert.deepEqual(docFormFields(kind, true), { recipient: true, amount: true }, kind);
    assert.deepEqual(docFormFields(kind, false), { recipient: true, amount: false }, kind);
  }
});

test("docs cleanup (F4): after create, the new document is found and announced", () => {
  assert.equal(createdMessage("rfi", 4), "RFI 004 created");
  assert.equal(createdMessage("change_order", 12), "Change order 012 created");
  assert.equal(newDocumentId([{ id: "a" }], [{ id: "b" }, { id: "a" }]), "b");
  assert.equal(newDocumentId([{ id: "a" }], [{ id: "a" }]), null);
});
