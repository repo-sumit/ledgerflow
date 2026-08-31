import { listRuns, type StoredRun } from "../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toClientRun(run: StoredRun) {
  return {
    id: run.id,
    createdAt: run.created_at,
    completedAt: run.completed_at,
    fileName: run.file_name,
    source: run.source,
    status: run.status,
    decision: run.decision,
    vendorName: run.vendor_name,
    invoiceNumber: run.invoice_number,
    poNumber: run.po_number,
    currency: run.currency,
    totalCents: run.total_cents,
    reason: run.reason,
    processingMs: run.processing_ms,
    extraction: run.extraction,
    checks: run.checks,
    stages: run.stages,
  };
}

export async function GET() {
  try {
    const rows = await listRuns();
    return Response.json({ runs: rows.map(toClientRun) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load run history." },
      { status: 500 },
    );
  }
}
