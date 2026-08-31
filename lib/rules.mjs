export const PURCHASE_ORDERS = [
  { poNumber: "PO-4471", vendorId: "VEN-001", vendorName: "Northwind Traders", currency: "USD", amountBasis: "GROSS", approvedAmount: 48250, alreadyInvoiced: 0, toleranceAmount: 50, tolerancePct: 0.005, allowPartial: false, status: "OPEN" },
  { poNumber: "PO-8834", vendorId: "VEN-002", vendorName: "BluePeak Cloud Services", currency: "USD", amountBasis: "GROSS", approvedAmount: 12000, alreadyInvoiced: 7000, toleranceAmount: 25, tolerancePct: 0.005, allowPartial: true, status: "PARTIALLY_INVOICED" },
  { poNumber: "PO-2007", vendorId: "VEN-003", vendorName: "Meridian Logistics", currency: "USD", amountBasis: "PRE_TAX", approvedAmount: 9800, alreadyInvoiced: 0, toleranceAmount: 25, tolerancePct: 0.005, expectedTaxRate: 0.1, allowPartial: false, status: "OPEN" },
];

export const SAMPLE_INVOICES = {
  happy: {
    fileName: "northwind-inv-20831.pdf",
    extraction: {
      vendorName: "Northwind Traders", vendorTaxId: "US-NT-884219", invoiceNumber: "INV-20831", invoiceDate: "2026-08-12", dueDate: "2026-09-11", poNumber: "PO-4471", currency: "USD", subtotal: 45000, tax: 3250, total: 48250,
      lineItems: [{ description: "Enterprise workspace licenses", quantity: 250, unitPrice: 180, amount: 45000 }], extractionConfidence: "HIGH", warnings: [],
    },
  },
  partial: {
    fileName: "bluepeak-partial-7781.pdf",
    extraction: {
      vendorName: "BluePeak Cloud Services", vendorTaxId: "US-BP-510993", invoiceNumber: "BP-7781", invoiceDate: "2026-08-19", dueDate: "2026-09-18", poNumber: "PO-8834", currency: "USD", subtotal: 4800, tax: 0, total: 4800,
      lineItems: [{ description: "Cloud hosting - August milestone", quantity: 1, unitPrice: 4800, amount: 4800 }], extractionConfidence: "HIGH", warnings: ["Invoice is marked as a partial billing milestone."],
    },
  },
  tax: {
    fileName: "meridian-tax-inclusive-9012.pdf",
    extraction: {
      vendorName: "Meridian Logistics", vendorTaxId: "US-ML-774291", invoiceNumber: "ML-9012", invoiceDate: "2026-08-21", dueDate: "2026-09-20", poNumber: "PO-2007", currency: "USD", subtotal: 9800, tax: 980, total: 10780,
      lineItems: [{ description: "Regional freight services", quantity: 1, unitPrice: 9800, amount: 9800 }], extractionConfidence: "HIGH", warnings: ["Invoice total includes 10% tax while the PO is recorded pre-tax."],
    },
  },
  ambiguous: {
    fileName: "northwind-reference-ambiguous.pdf",
    extraction: {
      vendorName: "Northwind Trading Co.", vendorTaxId: null, invoiceNumber: "NT-4409", invoiceDate: "2026-08-23", dueDate: null, poNumber: "PO-447I", currency: "USD", subtotal: 42000, tax: 0, total: 42000,
      lineItems: [{ description: "Workspace license renewal", quantity: 1, unitPrice: 42000, amount: 42000 }], extractionConfidence: "MEDIUM", warnings: ["The PO reference may contain the letter I or the number 1.", "Vendor tax ID is not present."],
    },
  },
};

function normalize(value) {
  return String(value ?? "").toUpperCase().replace(/\b(LTD|LIMITED|LLC|INC|CORP|CORPORATION|CO|COMPANY)\b/g, "").replace(/[^A-Z0-9]/g, "");
}
function money(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function check(id, label, status, detail) { return { id, label, status, detail }; }

export function evaluateInvoice(invoice, context = {}) {
  const checks = [];
  const missing = ["vendorName", "invoiceNumber", "invoiceDate", "poNumber", "currency", "total"].filter((field) => invoice[field] === null || invoice[field] === undefined || invoice[field] === "");
  checks.push(check("required", "Required fields", missing.length ? "WARN" : "PASS", missing.length ? `Missing: ${missing.join(", ")}.` : "All approval-critical fields are present."));
  checks.push(check("duplicate", "Duplicate protection", context.isDuplicate ? "FAIL" : "PASS", context.isDuplicate ? "The same vendor and invoice number already exists in run history." : "No prior invoice with this vendor and invoice number was found."));

  const po = PURCHASE_ORDERS.find((item) => normalize(item.poNumber) === normalize(invoice.poNumber));
  if (!po) {
    const candidate = PURCHASE_ORDERS.find((item) => normalize(item.vendorName) === normalize(invoice.vendorName));
    checks.push(check("po", "Purchase order match", "WARN", candidate ? `No exact PO match. ${candidate.poNumber} is a possible candidate and requires human confirmation.` : "No purchase order matched the submitted reference."));
  } else {
    checks.push(check("po", "Purchase order match", "PASS", `${po.poNumber} found with status ${po.status.toLowerCase().replaceAll("_", " ")}.`));
    const vendorMatch = normalize(po.vendorName) === normalize(invoice.vendorName);
    checks.push(check("vendor", "Vendor identity", vendorMatch ? "PASS" : "WARN", vendorMatch ? `Invoice vendor matches ${po.vendorName}.` : `Invoice says “${invoice.vendorName}”; PO belongs to “${po.vendorName}”.`));
    const currencyMatch = po.currency === String(invoice.currency ?? "").toUpperCase();
    checks.push(check("currency", "Currency", currencyMatch ? "PASS" : "WARN", currencyMatch ? `${po.currency} matches the PO.` : `Invoice currency ${invoice.currency || "is missing"}; PO currency is ${po.currency}.`));

    const subtotal = money(invoice.subtotal), tax = money(invoice.tax), total = money(invoice.total);
    const mathDelta = Math.abs(subtotal + tax - total);
    checks.push(check("arithmetic", "Invoice arithmetic", mathDelta <= 0.01 ? "PASS" : "WARN", mathDelta <= 0.01 ? "Subtotal plus tax equals the invoice total." : `Subtotal plus tax differs from total by ${mathDelta.toFixed(2)}.`));
    const comparisonAmount = po.amountBasis === "PRE_TAX" ? subtotal : total;
    const available = po.approvedAmount - po.alreadyInvoiced;
    const tolerance = Math.max(po.toleranceAmount, po.approvedAmount * po.tolerancePct);
    const target = po.allowPartial ? available : po.approvedAmount;
    const variance = comparisonAmount - target;
    const within = po.allowPartial ? comparisonAmount <= available + tolerance : Math.abs(variance) <= tolerance;
    checks.push(check("amount", po.allowPartial ? "Remaining PO balance" : "PO amount and tolerance", within ? "PASS" : "FAIL", po.allowPartial ? `${comparisonAmount.toFixed(2)} compared with ${available.toFixed(2)} remaining; tolerance is ${tolerance.toFixed(2)}.` : `${comparisonAmount.toFixed(2)} compared with ${po.approvedAmount.toFixed(2)}; variance is ${variance.toFixed(2)} and tolerance is ${tolerance.toFixed(2)}.`));
    if (po.amountBasis === "PRE_TAX") {
      const expectedTax = subtotal * (po.expectedTaxRate ?? 0), taxDelta = Math.abs(expectedTax - tax);
      checks.push(check("tax", "Tax normalization", taxDelta <= 1 ? "PASS" : "WARN", taxDelta <= 1 ? `PO is pre-tax. ${tax.toFixed(2)} tax was validated separately at ${((po.expectedTaxRate ?? 0) * 100).toFixed(0)}%.` : `Expected tax is ${expectedTax.toFixed(2)}, but the invoice reports ${tax.toFixed(2)}.`));
    }
  }

  const lineTotal = Array.isArray(invoice.lineItems) ? invoice.lineItems.reduce((sum, item) => sum + money(item.amount), 0) : 0;
  if (lineTotal > 0) {
    const delta = Math.abs(lineTotal - money(invoice.subtotal));
    checks.push(check("lines", "Line-item reconciliation", delta <= 1 ? "PASS" : "WARN", delta <= 1 ? "Line items reconcile to the subtotal." : `Line items differ from subtotal by ${delta.toFixed(2)}.`));
  }

  let decision = "AUTO_APPROVED", reason = "All approval-critical controls passed. The invoice is ready for payment scheduling.";
  if (context.isDuplicate) { decision = "REJECTED"; reason = "Rejected as a duplicate to prevent a second payment."; }
  else if (checks.some((item) => item.status === "FAIL")) { decision = "REJECTED"; reason = "A hard financial control failed. The invoice should not proceed to payment."; }
  else if (missing.length || !po || checks.some((item) => item.status === "WARN") || invoice.extractionConfidence === "LOW") { decision = "NEEDS_REVIEW"; reason = "The workflow found an ambiguity that requires an AP analyst before payment can proceed."; }
  return { decision, reason, checks, matchedPo: po ?? null };
}
