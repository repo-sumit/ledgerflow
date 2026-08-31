import test from "node:test";
import assert from "node:assert/strict";
import { evaluateInvoice, SAMPLE_INVOICES } from "../lib/rules.mjs";

test("clean invoice is auto-approved", () => {
  const result = evaluateInvoice(SAMPLE_INVOICES.happy.extraction);
  assert.equal(result.decision, "AUTO_APPROVED");
  assert.equal(result.checks.every((check) => check.status === "PASS"), true);
});

test("partial invoice respects remaining PO balance", () => {
  const result = evaluateInvoice(SAMPLE_INVOICES.partial.extraction);
  assert.equal(result.decision, "AUTO_APPROVED");
  assert.equal(result.checks.find((check) => check.id === "amount")?.status, "PASS");
});

test("pre-tax PO validates tax separately", () => {
  const result = evaluateInvoice(SAMPLE_INVOICES.tax.extraction);
  assert.equal(result.checks.find((check) => check.id === "tax")?.status, "PASS");
});

test("ambiguous PO is routed to human review", () => {
  const result = evaluateInvoice(SAMPLE_INVOICES.ambiguous.extraction);
  assert.equal(result.decision, "NEEDS_REVIEW");
  assert.equal(result.checks.find((check) => check.id === "po")?.status, "WARN");
});

test("duplicate invoice is rejected as a hard stop", () => {
  const result = evaluateInvoice(SAMPLE_INVOICES.happy.extraction, { isDuplicate: true });
  assert.equal(result.decision, "REJECTED");
  assert.match(result.reason, /duplicate/i);
});

test("invoice over the PO limit is rejected", () => {
  const invoice = structuredClone(SAMPLE_INVOICES.happy.extraction);
  invoice.total = 60000;
  invoice.subtotal = 56750;
  invoice.lineItems[0].amount = 56750;
  const result = evaluateInvoice(invoice);
  assert.equal(result.decision, "REJECTED");
  assert.equal(result.checks.find((check) => check.id === "amount")?.status, "FAIL");
});
