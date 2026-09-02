"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileCheck2,
  FileSearch,
  RotateCcw,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

type StageStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED";
type Stage = { id: string; label: string; status: StageStatus; detail: string; completedAt?: string };
type Check = { id: string; label: string; status: "PASS" | "WARN" | "FAIL"; detail: string };
type Extraction = {
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
  extractionConfidence: "HIGH" | "MEDIUM" | "LOW";
  warnings: string[];
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
};
type Run = {
  id: string;
  createdAt: string;
  completedAt?: string | null;
  fileName: string;
  source: string;
  status: string;
  decision?: "AUTO_APPROVED" | "NEEDS_REVIEW" | "REJECTED" | null;
  vendorName?: string | null;
  invoiceNumber?: string | null;
  poNumber?: string | null;
  currency?: string | null;
  totalCents?: number | null;
  reason?: string | null;
  processingMs?: number | null;
  extraction?: Extraction | null;
  checks?: Check[] | null;
  stages?: Stage[] | null;
  matchedPo?: Record<string, unknown> | null;
};

const EMPTY_STAGES: Stage[] = [
  { id: "intake", label: "Validate document", status: "PENDING", detail: "Waiting for an invoice" },
  { id: "extract", label: "Extract invoice data", status: "PENDING", detail: "Waiting" },
  { id: "match", label: "Match PO and duplicates", status: "PENDING", detail: "Waiting" },
  { id: "controls", label: "Apply financial controls", status: "PENDING", detail: "Waiting" },
  { id: "decision", label: "Record decision", status: "PENDING", detail: "Waiting" },
];

const SCENARIOS = [
  { id: "happy", title: "Clean match", note: "Expected: auto-approved" },
  { id: "partial", title: "Partial billing", note: "Expected: auto-approved" },
  { id: "tax", title: "Tax normalization", note: "Expected: auto-approved" },
  { id: "ambiguous", title: "Ambiguous PO", note: "Expected: needs review" },
] as const;

const decisionMeta = {
  AUTO_APPROVED: {
    label: "Auto-approved",
    icon: CheckCircle2,
    banner: "border-emerald-200 bg-emerald-50",
    iconStyle: "bg-emerald-100 text-emerald-700",
    text: "text-emerald-800",
    dot: "bg-emerald-500",
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    icon: AlertTriangle,
    banner: "border-amber-200 bg-amber-50",
    iconStyle: "bg-amber-100 text-amber-800",
    text: "text-amber-900",
    dot: "bg-amber-500",
  },
  REJECTED: {
    label: "Rejected",
    icon: XCircle,
    banner: "border-rose-200 bg-rose-50",
    iconStyle: "bg-rose-100 text-rose-700",
    text: "text-rose-900",
    dot: "bg-rose-500",
  },
};

const pageCopy = {
  process: { title: "New invoice", description: "Upload a PDF and review the payment decision." },
  history: { title: "Run history", description: "Open any previous decision and its supporting evidence." },
  impact: { title: "Insights", description: "Monitor decisions, exceptions, and processing performance." },
};

function formatMoney(cents?: number | null, currency = "USD") {
  if (cents === null || cents === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
}

function formatDuration(ms?: number | null) {
  if (!ms) return "N/A";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "COMPLETE") return <CheckCircle2 aria-label="Complete" className="h-4 w-4 text-emerald-600" />;
  if (status === "FAILED") return <XCircle aria-label="Failed" className="h-4 w-4 text-rose-600" />;
  if (status === "RUNNING") return <CircleDot aria-label="Running" className="h-4 w-4 animate-pulse text-blue-600" />;
  return <span aria-label="Pending" className="block h-3 w-3 rounded-full border border-slate-300 bg-white" />;
}

function DecisionBadge({ decision }: { decision?: Run["decision"] }) {
  if (!decision) return <Badge variant="outline">Processing</Badge>;
  const meta = decisionMeta[decision];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.banner} ${meta.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Stage[]>(EMPTY_STAGES);
  const [result, setResult] = useState<Run | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<keyof typeof pageCopy>("process");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/runs", { cache: "no-store" });
      if (!response.ok) throw new Error("History is unavailable.");
      const data = await response.json() as { runs: Run[] };
      setRuns(data.runs);
    } catch {
      // The empty state remains usable when history cannot be loaded.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    // Loading persisted history is the external synchronization this effect owns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRuns();
  }, [loadRuns]);

  const progress = useMemo(() => {
    const done = stages.filter((stage) => stage.status === "COMPLETE").length;
    const active = stages.some((stage) => stage.status === "RUNNING") ? 0.45 : 0;
    return Math.round(((done + active) / stages.length) * 100);
  }, [stages]);

  const metrics = useMemo(() => {
    const completed = runs.filter((run) => run.status === "COMPLETED");
    const auto = completed.filter((run) => run.decision === "AUTO_APPROVED").length;
    const exceptions = completed.filter((run) => run.decision !== "AUTO_APPROVED").length;
    const duplicateBlocks = completed.filter((run) => run.checks?.some((item) => item.id === "duplicate" && item.status === "FAIL")).length;
    const avgMs = completed.length ? completed.reduce((sum, run) => sum + (run.processingMs ?? 0), 0) / completed.length : 0;
    return {
      total: completed.length,
      auto,
      exceptions,
      duplicateBlocks,
      avgMs,
      autoRate: completed.length ? Math.round((auto / completed.length) * 100) : 0,
    };
  }, [runs]);

  const hasStarted = running || result !== null || stages.some((stage) => stage.status !== "PENDING");

  async function runWorkflow(sampleId?: string) {
    if (!sampleId && !file) {
      toast.error("Choose a PDF invoice first.");
      return;
    }

    setRunning(true);
    setResult(null);
    setStages(EMPTY_STAGES.map((stage) => ({ ...stage })));
    setActiveTab("process");
    const form = new FormData();
    if (sampleId) form.append("sampleId", sampleId);
    else if (file) form.append("invoice", file);

    try {
      const response = await fetch("/api/process", { method: "POST", body: form });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({ error: "Workflow could not start." })) as { error?: string };
        throw new Error(payload.error ?? "Workflow could not start.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; stage?: Stage; result?: Run; error?: string };
          if (event.type === "stage" && event.stage) {
            setStages((current) => current.map((stage) => stage.id === event.stage!.id ? event.stage! : stage));
          }
          if (event.type === "result" && event.result) {
            setResult(event.result);
            toast.success("Invoice decision completed.");
          }
          if (event.type === "error") throw new Error(event.error ?? "Workflow failed.");
        }
        if (done) break;
      }
      await loadRuns();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Workflow failed.");
    } finally {
      setRunning(false);
    }
  }

  function resetRun() {
    setFile(null);
    setResult(null);
    setStages(EMPTY_STAGES.map((stage) => ({ ...stage })));
    if (inputRef.current) inputRef.current.value = "";
  }

  function openRun(run: Run) {
    setResult(run);
    setStages(run.stages ?? EMPTY_STAGES);
    setActiveTab("process");
  }

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-slate-950">
      <Toaster richColors position="top-right" />

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-950 text-white">
              <FileCheck2 className="h-4.5 w-4.5" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">LedgerFlow</h1>
              <p className="text-xs text-slate-500">Invoice control</p>
            </div>
          </div>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500">Synthetic demo data</span>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] px-5 py-7 lg:px-8 lg:py-9">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as keyof typeof pageCopy)}>
          <div className="mb-7 flex flex-col justify-between gap-5 border-b border-slate-200 pb-5 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">{pageCopy[activeTab].title}</h2>
              <p className="mt-1 text-sm text-slate-500">{pageCopy[activeTab].description}</p>
            </div>
            <TabsList className="h-10 w-full justify-start rounded-lg bg-slate-200/70 p-1 sm:w-auto">
              <TabsTrigger value="process" className="px-4">New invoice</TabsTrigger>
              <TabsTrigger value="history" className="px-4">History</TabsTrigger>
              <TabsTrigger value="impact" className="px-4">Insights</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="process" className="mt-0 space-y-5">
            <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
              <section className="panel p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">Invoice PDF</h3>
                    <p className="mt-1 text-xs text-slate-500">PDF only, up to 8 MB</p>
                  </div>
                  {file ? (
                    <Button variant="ghost" size="sm" onClick={resetRun} disabled={running}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reset
                    </Button>
                  ) : null}
                </div>

                <label className={`upload-zone ${file ? "upload-zone-active" : ""}`}>
                  <input
                    ref={inputRef}
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    disabled={running}
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                  <UploadCloud className="h-5 w-5 text-slate-500" />
                  {file ? (
                    <>
                      <p className="mt-3 max-w-full truncate text-sm font-medium text-slate-900">{file.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</p>
                      <span className="mt-3 text-xs font-medium text-blue-700">Choose another file</span>
                    </>
                  ) : (
                    <>
                      <p className="mt-3 text-sm font-medium text-slate-900">Choose an invoice</p>
                      <p className="mt-1 text-xs text-slate-500">or drop it here</p>
                    </>
                  )}
                </label>

                <Button className="mt-4 h-10 w-full bg-slate-950 hover:bg-slate-800" disabled={!file || running} onClick={() => void runWorkflow()}>
                  {running ? <><CircleDot className="mr-2 h-4 w-4 animate-pulse" />Processing</> : "Review invoice"}
                </Button>

                <details className="demo-cases">
                  <summary>
                    <span>Demo cases</span>
                    <ChevronDown className="h-4 w-4" />
                  </summary>
                  <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                    {SCENARIOS.map((scenario) => (
                      <button
                        key={scenario.id}
                        type="button"
                        disabled={running}
                        onClick={() => void runWorkflow(scenario.id)}
                        className="demo-case-row"
                      >
                        <span className="text-sm font-medium text-slate-800">{scenario.title}</span>
                        <span className="text-xs text-slate-500">{scenario.note}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-500">Demo cases use fixtures. PDF uploads use live Gemini extraction.</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <a className="download-link" href="/samples/northwind-inv-20831.pdf" download>Clean PDF</a>
                    <a className="download-link" href="/samples/bluepeak-partial-7781.pdf" download>Partial PDF</a>
                    <a className="download-link" href="/samples/meridian-tax-inclusive-9012.pdf" download>Tax PDF</a>
                    <a className="download-link" href="/samples/northwind-reference-ambiguous.pdf" download>Ambiguous PDF</a>
                  </div>
                </details>
              </section>

              <section className="panel min-h-[390px] overflow-hidden" aria-busy={running}>
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <div>
                    <h3 className="text-base font-semibold">Processing status</h3>
                    <p className="mt-1 text-xs text-slate-500">Extraction, matching, controls, and decision</p>
                  </div>
                  <span className={`status-label ${running ? "status-running" : ""}`} aria-live="polite">
                    {running ? "Running" : result ? "Complete" : "Ready"}
                  </span>
                </div>

                {hasStarted ? (
                  <div>
                    <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
                      <Progress value={progress} className="h-1.5 flex-1" />
                      <span className="w-9 text-right text-xs tabular-nums text-slate-500">{progress}%</span>
                    </div>
                    <div className="divide-y divide-slate-100 px-5">
                      {stages.map((stage) => (
                        <div key={stage.id} className="flex gap-3 py-4">
                          <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-slate-200 bg-white">
                            <StageIcon status={stage.status} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">{stage.label}</p>
                            <p className={`mt-0.5 text-xs leading-5 ${stage.status === "FAILED" ? "text-rose-600" : "text-slate-500"}`}>{stage.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-[300px] place-items-center px-6 text-center">
                    <div>
                      <FileSearch className="mx-auto h-7 w-7 text-slate-300" />
                      <p className="mt-3 text-sm font-medium text-slate-700">No invoice submitted</p>
                      <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">Processing steps and validation results will appear here.</p>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {result ? <ResultPanel run={result} /> : null}
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <section className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <p className="text-sm text-slate-500">{runs.length} saved run{runs.length === 1 ? "" : "s"}</p>
                <Button variant="outline" size="sm" onClick={() => void loadRuns()}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Refresh
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>PO</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Processed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>
                          <button type="button" onClick={() => openRun(run)} className="text-left hover:underline">
                            <span className="block font-medium text-slate-900">{run.invoiceNumber || "Awaiting extraction"}</span>
                            <span className="block max-w-[190px] truncate text-xs text-slate-500">{run.fileName}</span>
                          </button>
                        </TableCell>
                        <TableCell>{run.vendorName || "N/A"}</TableCell>
                        <TableCell className="font-mono text-xs">{run.poNumber || "N/A"}</TableCell>
                        <TableCell>{formatMoney(run.totalCents, run.currency || "USD")}</TableCell>
                        <TableCell><DecisionBadge decision={run.decision} /></TableCell>
                        <TableCell className="text-xs text-slate-500">{run.source === "GEMINI_PDF" ? "Live PDF" : "Demo case"}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-slate-500">{new Date(run.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                    {!historyLoading && runs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <div className="py-14 text-center">
                            <p className="text-sm font-medium">No runs yet</p>
                            <p className="mt-1 text-xs text-slate-500">Review an invoice to create the first record.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="impact" className="mt-0 space-y-5">
            <div className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Invoices processed" value={metrics.total.toString()} note="Completed runs" />
              <Metric label="Straight-through rate" value={`${metrics.autoRate}%`} note={`${metrics.auto} auto-approved`} />
              <Metric label="Exceptions" value={metrics.exceptions.toString()} note="Review or reject" />
              <Metric label="Duplicates blocked" value={metrics.duplicateBlocks.toString()} note="Hard-control stops" />
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
              <section className="panel p-5">
                <h3 className="text-base font-semibold">Decision mix</h3>
                <p className="mt-1 text-xs text-slate-500">Distribution across completed runs</p>
                <div className="mt-6 space-y-5">
                  {(["AUTO_APPROVED", "NEEDS_REVIEW", "REJECTED"] as const).map((decision) => {
                    const count = runs.filter((run) => run.decision === decision).length;
                    const percent = metrics.total ? Math.round((count / metrics.total) * 100) : 0;
                    return (
                      <div key={decision}>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="font-medium">{decisionMeta[decision].label}</span>
                          <span className="text-slate-500">{count} · {percent}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${decision === "AUTO_APPROVED" ? "bg-emerald-500" : decision === "NEEDS_REVIEW" ? "bg-amber-400" : "bg-rose-500"}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="panel p-5">
                <h3 className="text-base font-semibold">Operating measures</h3>
                <div className="mt-4 divide-y divide-slate-100">
                  <Measure label="Average processing time" value={formatDuration(metrics.avgMs)} />
                  <Measure label="Estimated manual time avoided" value={`${metrics.auto * 8} min`} />
                  <Measure label="Potential repeat payments stopped" value={metrics.duplicateBlocks.toString()} />
                </div>
                <p className="mt-4 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">Time avoided assumes 8 manual minutes per auto-approved invoice. Decision counts and processing time come from the run log.</p>
              </section>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function ResultPanel({ run }: { run: Run }) {
  if (!run.decision) return null;
  const meta = decisionMeta[run.decision];
  const Icon = meta.icon;
  const extraction = run.extraction;
  const severity = { FAIL: 0, WARN: 1, PASS: 2 };
  const checks = [...(run.checks ?? [])].sort((a, b) => severity[a.status] - severity[b.status]);
  const passCount = checks.filter((check) => check.status === "PASS").length;

  return (
    <section className="panel overflow-hidden">
      <div className={`flex flex-col justify-between gap-5 border-b px-5 py-5 sm:flex-row sm:items-center ${meta.banner}`}>
        <div className="flex gap-3">
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${meta.iconStyle}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className={`text-lg font-semibold ${meta.text}`}>{meta.label}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-700">{run.reason}</p>
          </div>
        </div>
        <div className="flex gap-7 sm:text-right">
          <SummaryValue label="Invoice total" value={formatMoney(run.totalCents, run.currency || "USD")} />
          <SummaryValue label="Processing time" value={formatDuration(run.processingMs)} />
        </div>
      </div>

      <div className="grid lg:grid-cols-[0.85fr_1.15fr]">
        <div className="border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
          <h4 className="text-sm font-semibold">Invoice details</h4>
          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
            <Field label="Vendor" value={extraction?.vendorName} wide />
            <Field label="Invoice number" value={extraction?.invoiceNumber} mono />
            <Field label="PO reference" value={extraction?.poNumber} mono />
            <Field label="Invoice date" value={extraction?.invoiceDate} />
            <Field label="Subtotal" value={extraction?.subtotal === null || extraction?.subtotal === undefined ? null : formatMoney(Math.round(extraction.subtotal * 100), extraction.currency || "USD")} />
            <Field label="Tax" value={extraction?.tax === null || extraction?.tax === undefined ? null : formatMoney(Math.round(extraction.tax * 100), extraction.currency || "USD")} />
            <Field label="Confidence" value={extraction?.extractionConfidence} />
            <Field label="Source" value={run.source === "GEMINI_PDF" ? "Live PDF" : "Demo case"} />
          </div>

          {extraction?.warnings?.length ? (
            <div className="mt-5 border-l-2 border-amber-400 pl-3">
              <p className="text-xs font-medium text-amber-900">Extraction notes</p>
              {extraction.warnings.map((warning) => <p key={warning} className="mt-1 text-xs leading-5 text-slate-600">{warning}</p>)}
            </div>
          ) : null}
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">Control results</h4>
            <span className="text-xs text-slate-500">{passCount} of {checks.length} passed</span>
          </div>
          <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
            {checks.map((check) => (
              <div key={check.id} className="flex gap-3 py-3.5">
                <div className={`mt-0.5 ${check.status === "PASS" ? "text-emerald-600" : check.status === "WARN" ? "text-amber-600" : "text-rose-600"}`}>
                  {check.status === "PASS" ? <CheckCircle2 className="h-4 w-4" /> : check.status === "WARN" ? <AlertTriangle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{check.label}</p>
                    <span className={`text-[10px] font-semibold ${check.status === "PASS" ? "text-emerald-700" : check.status === "WARN" ? "text-amber-700" : "text-rose-700"}`}>{check.status}</span>
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, value, mono = false, wide = false }: { label: string; value?: string | null; mono?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 break-words text-sm font-medium text-slate-900 ${mono ? "font-mono text-xs" : ""}`}>{value || "Not found"}</p>
    </div>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-base font-semibold tabular-nums">{value}</p></div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="metric-cell"><p>{label}</p><strong>{value}</strong><span>{note}</span></div>;
}

function Measure({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 py-3"><p className="text-sm text-slate-600">{label}</p><p className="text-sm font-semibold tabular-nums text-slate-950">{value}</p></div>;
}
