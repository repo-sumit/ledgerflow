import { z } from "zod";
import type { InvoiceExtraction } from "./types";

const invoiceSchema = z.object({
  vendorName: z.string().nullable(), vendorTaxId: z.string().nullable(), invoiceNumber: z.string().nullable(), invoiceDate: z.string().nullable(), dueDate: z.string().nullable(), poNumber: z.string().nullable(), currency: z.string().nullable(), subtotal: z.number().nullable(), tax: z.number().nullable(), total: z.number().nullable(),
  lineItems: z.array(z.object({ description: z.string(), quantity: z.number(), unitPrice: z.number(), amount: z.number() })),
  extractionConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]), warnings: z.array(z.string()),
});

const responseSchema = {
  type: "object",
  properties: {
    vendorName: { type: ["string", "null"], description: "Legal vendor name exactly as printed." }, vendorTaxId: { type: ["string", "null"] }, invoiceNumber: { type: ["string", "null"] }, invoiceDate: { type: ["string", "null"], description: "ISO date YYYY-MM-DD." }, dueDate: { type: ["string", "null"], description: "ISO date YYYY-MM-DD." }, poNumber: { type: ["string", "null"], description: "Purchase order reference exactly as printed." }, currency: { type: ["string", "null"], description: "Three-letter ISO currency code." }, subtotal: { type: ["number", "null"] }, tax: { type: ["number", "null"] }, total: { type: ["number", "null"] },
    lineItems: { type: "array", items: { type: "object", properties: { description: { type: "string" }, quantity: { type: "number" }, unitPrice: { type: "number" }, amount: { type: "number" } }, required: ["description", "quantity", "unitPrice", "amount"] } },
    extractionConfidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] }, warnings: { type: "array", items: { type: "string" } },
  },
  required: ["vendorName", "vendorTaxId", "invoiceNumber", "invoiceDate", "dueDate", "poNumber", "currency", "subtotal", "tax", "total", "lineItems", "extractionConfidence", "warnings"],
};

function encodeBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

function extractOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index] as { content?: Array<{ text?: string }> };
    const text = step.content?.find((item) => typeof item.text === "string")?.text;
    if (text) return text;
  }
  throw new Error("The extraction service returned no structured invoice data.");
}

export async function extractInvoiceFromPdf(file: File, apiKey: string): Promise<InvoiceExtraction> {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model: "gemini-3.5-flash-lite",
      input: [
        { type: "document", data: encodeBase64(await file.arrayBuffer()), mime_type: "application/pdf" },
        { type: "text", text: "Extract this vendor invoice faithfully. Do not infer missing values. Preserve the printed PO reference exactly. Return amounts as numbers without currency symbols. Flag ambiguity, illegible text, inconsistent totals, and uncertain characters in warnings. Confidence is LOW if any approval-critical field is uncertain, MEDIUM for minor non-critical uncertainties, otherwise HIGH." },
      ],
      response_format: { type: "text", mime_type: "application/json", schema: responseSchema },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 429) throw new Error("The free extraction quota is temporarily busy. Please retry in a moment.");
    throw new Error(`Invoice extraction failed (${response.status}): ${detail.slice(0, 180)}`);
  }
  const raw = extractOutputText(await response.json() as Record<string, unknown>);
  const parsed = invoiceSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("The invoice was read, but its structured output did not pass validation.");
  return parsed.data;
}
