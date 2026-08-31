export type InvoiceExtraction = { vendorName: string | null; vendorTaxId: string | null; invoiceNumber: string | null; invoiceDate: string | null; dueDate: string | null; poNumber: string | null; currency: string | null; subtotal: number | null; tax: number | null; total: number | null; lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>; extractionConfidence: "HIGH" | "MEDIUM" | "LOW"; warnings: string[] };
export type RuleCheck = { id: string; label: string; status: "PASS" | "WARN" | "FAIL"; detail: string };
export type PurchaseOrder = Record<string, string | number | boolean | undefined>;
export const PURCHASE_ORDERS: PurchaseOrder[];
export const SAMPLE_INVOICES: Record<string, { fileName: string; extraction: InvoiceExtraction }>;
export function evaluateInvoice(invoice: InvoiceExtraction, context?: { isDuplicate?: boolean }): { decision: "AUTO_APPROVED" | "NEEDS_REVIEW" | "REJECTED"; reason: string; checks: RuleCheck[]; matchedPo: PurchaseOrder | null };
