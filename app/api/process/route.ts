import { insertRun, reserveInvoiceIdentity, updateRun } from "../../../lib/database";
import { extractInvoiceFromPdf } from "../../../lib/extraction";
import { evaluateInvoice, SAMPLE_INVOICES } from "../../../lib/rules.mjs";
import type { InvoiceExtraction, RuleCheck } from "../../../lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type StageState = {
  id: string;
  label: string;
  status: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED";
  detail: string;
  completedAt?: string;
};

const STAGES: StageState[] = [
  { id: "intake", label: "Secure intake", status: "PENDING", detail: "Waiting for invoice" },
  { id: "extract", label: "Document extraction", status: "PENDING", detail: "Waiting" },
  { id: "match", label: "PO and duplicate match", status: "PENDING", detail: "Waiting" },
  { id: "controls", label: "Financial controls", status: "PENDING", detail: "Waiting" },
  { id: "decision", label: "Decision and audit trail", status: "PENDING", detail: "Waiting" },
];

function key(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/\b(LTD|LIMITED|LLC|INC|CORP|CORPORATION|CO|COMPANY)\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPdf(file: File) {
  const signature = Buffer.from(await file.slice(0, 5).arrayBuffer()).toString("ascii");
  return signature === "%PDF-";
}

export async function POST(request: Request) {
  const form = await request.formData();
  const sampleId = String(form.get("sampleId") ?? "");
  const samples = SAMPLE_INVOICES as Record<string, { fileName: string; extraction: InvoiceExtraction }>;
  const sample = sampleId ? samples[sampleId] : undefined;
  const fileValue = form.get("invoice");
  const file = fileValue instanceof File ? fileValue : null;

  if (!sample && !file) {
    return Response.json({ error: "Choose a PDF invoice or a guided scenario." }, { status: 400 });
  }
  if (file && file.size > 8 * 1024 * 1024) {
    return Response.json({ error: "PDF must be 8 MB or smaller." }, { status: 400 });
  }
  if (file && !(await isPdf(file))) {
    return Response.json({ error: "The uploaded file is not a valid PDF." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const createdAt = new Date(startedAt).toISOString();
  const fileName = sample?.fileName ?? file?.name ?? "invoice.pdf";
  const source = sample ? "GUIDED_SCENARIO" : "GEMINI_PDF";

  const stream = new ReadableStream({
    async start(controller) {
      const stageStates = STAGES.map((stage) => ({ ...stage }));
      let currentStage = "intake";
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const updateStage = (id: string, status: StageState["status"], detail: string) => {
        currentStage = id;
        const stage = stageStates.find((item) => item.id === id)!;
        stage.status = status;
        stage.detail = detail;
        if (status === "COMPLETE" || status === "FAILED") stage.completedAt = new Date().toISOString();
        send({ type: "stage", runId, stage });
      };

      try {
        await insertRun({ id: runId, created_at: createdAt, file_name: fileName, source, status: "PROCESSING", stages: stageStates });
        send({ type: "started", runId, fileName, source });

        updateStage("intake", "RUNNING", "Validating file type, size and run identity");
        if (sample) await wait(220);
        updateStage("intake", "COMPLETE", `${fileName} accepted and assigned run ${runId.slice(0, 8)}`);

        updateStage("extract", "RUNNING", sample ? "Loading a transparent guided test fixture" : "Reading the PDF with Gemini 3.5 Flash-Lite");
        let extraction: InvoiceExtraction;
        if (sample) {
          await wait(420);
          extraction = sample.extraction;
        } else {
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) throw new Error("Live PDF extraction is not configured. Add GEMINI_API_KEY or use a guided scenario.");
          extraction = await extractInvoiceFromPdf(file!, apiKey);
        }
        updateStage("extract", "COMPLETE", `${extraction.lineItems.length} line item${extraction.lineItems.length === 1 ? "" : "s"} extracted with ${extraction.extractionConfidence.toLowerCase()} confidence`);

        updateStage("match", "RUNNING", "Searching PO master and atomically reserving the invoice identity");
        const vendorKey = key(extraction.vendorName);
        const invoiceKey = key(extraction.invoiceNumber);
        const isDuplicate = vendorKey && invoiceKey
          ? await reserveInvoiceIdentity(runId, vendorKey, invoiceKey)
          : false;
        if (sample) await wait(280);
        updateStage("match", "COMPLETE", isDuplicate ? "A prior invoice with the same identity was found" : "PO search complete; no duplicate found");

        updateStage("controls", "RUNNING", "Applying required-field, vendor, currency, arithmetic, tolerance and balance rules");
        const evaluation = evaluateInvoice(extraction, { isDuplicate });
        if (sample) await wait(360);
        const passCount = evaluation.checks.filter((item: RuleCheck) => item.status === "PASS").length;
        updateStage("controls", "COMPLETE", `${passCount} of ${evaluation.checks.length} controls passed`);

        updateStage("decision", "RUNNING", "Writing an explainable outcome and persistent audit record");
        if (sample) await wait(260);
        const completedAt = new Date().toISOString();
        const processingMs = Date.now() - startedAt;
        const decisionStage = stageStates.find((item) => item.id === "decision")!;
        decisionStage.status = "COMPLETE";
        decisionStage.detail = "Decision recorded with evidence and next action";
        decisionStage.completedAt = completedAt;

        await updateRun(runId, {
          completed_at: completedAt,
          status: "COMPLETED",
          decision: evaluation.decision,
          vendor_name: extraction.vendorName,
          vendor_key: vendorKey,
          invoice_number: extraction.invoiceNumber,
          invoice_key: invoiceKey,
          po_number: extraction.poNumber,
          currency: extraction.currency,
          total_cents: extraction.total === null ? null : Math.round(extraction.total * 100),
          reason: evaluation.reason,
          processing_ms: processingMs,
          extraction,
          checks: evaluation.checks,
          stages: stageStates,
        });
        send({ type: "stage", runId, stage: decisionStage });

        send({
          type: "result",
          result: {
            id: runId,
            createdAt,
            completedAt,
            fileName,
            source,
            status: "COMPLETED",
            decision: evaluation.decision,
            vendorName: extraction.vendorName,
            invoiceNumber: extraction.invoiceNumber,
            poNumber: extraction.poNumber,
            currency: extraction.currency,
            totalCents: extraction.total === null ? null : Math.round(extraction.total * 100),
            reason: evaluation.reason,
            processingMs,
            extraction,
            checks: evaluation.checks,
            matchedPo: evaluation.matchedPo,
            stages: stageStates,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected workflow error";
        const failed = stageStates.find((item) => item.id === currentStage);
        if (failed) {
          failed.status = "FAILED";
          failed.detail = message;
          failed.completedAt = new Date().toISOString();
          send({ type: "stage", runId, stage: failed });
        }
        try {
          await updateRun(runId, {
            status: "FAILED",
            reason: message,
            processing_ms: Date.now() - startedAt,
            stages: stageStates,
            completed_at: new Date().toISOString(),
          });
        } catch {
          // The original workflow error is the useful one for the user.
        }
        send({ type: "error", runId, error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
