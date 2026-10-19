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
