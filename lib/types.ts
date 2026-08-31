export type InvoiceExtraction = {
  vendorName: string | null;
  vendorTaxId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  poNumber: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  extractionConfidence: "HIGH" | "MEDIUM" | "LOW";
  warnings: string[];
};

export type RuleCheck = {
  id: string;
  label: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
};
