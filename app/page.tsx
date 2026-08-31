"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, BarChart3, CheckCircle2, ChevronRight, CircleDot,
  Clock3, Database, FileCheck2, FileText, History, Info, Play, RotateCcw,
  SearchCheck, ShieldCheck, Sparkles, UploadCloud, XCircle,
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
  vendorName: string | null; vendorTaxId: string | null; invoiceNumber: string | null; invoiceDate: string | null;
  dueDate: string | null; poNumber: string | null; currency: string | null; subtotal: number | null;
  tax: number | null; total: number | null; extractionConfidence: "HIGH" | "MEDIUM" | "LOW";
  warnings: string[]; lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
};
type Run = {
  id: string; createdAt: string; completedAt?: string | null; fileName: string; source: string; status: string;
  decision?: "AUTO_APPROVED" | "NEEDS_REVIEW" | "REJECTED" | null; vendorName?: string | null;
  invoiceNumber?: string | null; poNumber?: string | null; currency?: string | null; totalCents?: number | null;
  reason?: string | null; processingMs?: number | null; extraction?: Extraction | null; checks?: Check[] | null;
  stages?: Stage[] | null; matchedPo?: Record<string, unknown> | null;
};

const EMPTY_STAGES: Stage[] = [
  { id: "intake", label: "Secure intake", status: "PENDING", detail: "Waiting for an invoice" },
  { id: "extract", label: "Document extraction", status: "PENDING", detail: "Waiting" },
  { id: "match", label: "PO and duplicate match", status: "PENDING", detail: "Waiting" },
  { id: "controls", label: "Financial controls", status: "PENDING", detail: "Waiting" },
  { id: "decision", label: "Decision and audit trail", status: "PENDING", detail: "Waiting" },
];

const SCENARIOS = [
  { id: "happy", title: "Clean match", note: "Full PO match", icon: CheckCircle2, tone: "emerald" },
  { id: "partial", title: "Partial billing", note: "Checks PO balance", icon: Database, tone: "blue" },
  { id: "tax", title: "Tax normalization", note: "Pre-tax PO", icon: SearchCheck, tone: "violet" },
  { id: "ambiguous", title: "Ambiguous PO", note: "Routes to review", icon: AlertTriangle, tone: "amber" },
] as const;

const decisionMeta = {
  AUTO_APPROVED: { label: "Auto-approved", icon: CheckCircle2, shell: "border-emerald-200 bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-500" },
  NEEDS_REVIEW: { label: "Needs review", icon: AlertTriangle, shell: "border-amber-200 bg-amber-50", text: "text-amber-800", dot: "bg-amber-500" },
  REJECTED: { label: "Rejected", icon: XCircle, shell: "border-rose-200 bg-rose-50", text: "text-rose-800", dot: "bg-rose-500" },
};

function formatMoney(cents?: number | null, currency = "USD") {
  if (cents === null || cents === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
}
function formatDuration(ms?: number | null) { if (!ms) return "N/A"; return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`; }
function StageIcon({ status }: { status: StageStatus }) {
  if (status === "COMPLETE") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "FAILED") return <XCircle className="h-4 w-4 text-rose-600" />;
  if (status === "RUNNING") return <CircleDot className="h-4 w-4 animate-pulse text-indigo-600" />;
  return <div className="h-3.5 w-3.5 rounded-full border-2 border-slate-300 bg-white" />;
}
function DecisionBadge({ decision }: { decision?: Run["decision"] }) {
  if (!decision) return <Badge variant="outline">Processing</Badge>;
  const meta = decisionMeta[decision];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.shell} ${meta.text}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}</span>;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Stage[]>(EMPTY_STAGES);
  const [result, setResult] = useState<Run | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("process");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/runs", { cache: "no-store" });
      if (!response.ok) throw new Error("History is unavailable.");
      const data = await response.json() as { runs: Run[] };
      setRuns(data.runs);
    } catch { /* Empty history is handled in the UI. */ }
    finally { setHistoryLoading(false); }
  }, []);
  useEffect(() => {
    // Loading the persisted audit history is the external synchronization this effect owns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRuns();
  }, [loadRuns]);

  const progress = useMemo(() => {
    const done = stages.filter((stage) => stage.status === "COMPLETE").length;
    const runningStage = stages.some((stage) => stage.status === "RUNNING") ? 0.45 : 0;
    return Math.round(((done + runningStage) / stages.length) * 100);
  }, [stages]);
  const metrics = useMemo(() => {
    const completed = runs.filter((run) => run.status === "COMPLETED");
    const auto = completed.filter((run) => run.decision === "AUTO_APPROVED").length;
    const exceptions = completed.filter((run) => run.decision !== "AUTO_APPROVED").length;
    const duplicateBlocks = completed.filter((run) => run.checks?.some((check) => check.id === "duplicate" && check.status === "FAIL")).length;
    const avgMs = completed.length ? completed.reduce((sum, run) => sum + (run.processingMs ?? 0), 0) / completed.length : 0;
    return { total: completed.length, auto, exceptions, duplicateBlocks, avgMs, autoRate: completed.length ? Math.round((auto / completed.length) * 100) : 0 };
  }, [runs]);

  async function runWorkflow(sampleId?: string) {
    if (!sampleId && !file) { toast.error("Choose a PDF invoice first."); return; }
    setRunning(true); setResult(null); setStages(EMPTY_STAGES.map((stage) => ({ ...stage }))); setActiveTab("process");
    const form = new FormData();
    if (sampleId) form.append("sampleId", sampleId); else if (file) form.append("invoice", file);
    try {
      const response = await fetch("/api/process", { method: "POST", body: form });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({ error: "Workflow could not start." })) as { error?: string };
        throw new Error(payload.error ?? "Workflow could not start.");
      }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; stage?: Stage; result?: Run; error?: string };
          if (event.type === "stage" && event.stage) setStages((current) => current.map((stage) => stage.id === event.stage!.id ? event.stage! : stage));
          if (event.type === "result" && event.result) { setResult(event.result); toast.success("Invoice decision completed."); }
          if (event.type === "error") throw new Error(event.error ?? "Workflow failed.");
        }
        if (done) break;
      }
      await loadRuns();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Workflow failed."); }
    finally { setRunning(false); }
  }

  function resetRun() { setFile(null); setResult(null); setStages(EMPTY_STAGES.map((stage) => ({ ...stage }))); if (inputRef.current) inputRef.current.value = ""; }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-950">
      <Toaster richColors position="top-right" />
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-5 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#172554] text-white shadow-sm"><FileCheck2 className="h-5 w-5" /></div><div><div className="flex items-center gap-2"><h1 className="text-lg font-bold tracking-tight">LedgerFlow</h1><Badge className="bg-indigo-50 text-indigo-700 hover:bg-indigo-50">AP decisioning</Badge></div><p className="text-xs text-slate-500">Explainable invoice controls, from PDF to payment decision</p></div></div>
          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex"><ShieldCheck className="h-4 w-4 text-emerald-600" /><span>Human review stays in control</span></div>
        </div>
      </header>

      <div className="mx-auto max-w-[1480px] px-5 py-6 lg:px-8 lg:py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">Accounts payable workspace</p><h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Make every invoice decision traceable.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">AI reads the document. Deterministic controls decide what happens next. Every rule, exception and action remains visible.</p></div><TabsList className="h-11 w-full bg-slate-200/70 p-1 lg:w-auto"><TabsTrigger value="process" className="gap-2 px-4"><Play className="h-4 w-4" />New run</TabsTrigger><TabsTrigger value="history" className="gap-2 px-4"><History className="h-4 w-4" />Run history</TabsTrigger><TabsTrigger value="impact" className="gap-2 px-4"><BarChart3 className="h-4 w-4" />Impact</TabsTrigger></TabsList></div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Invoices processed", value: metrics.total, note: "Completed runs", icon: FileText },
              { label: "Straight-through rate", value: `${metrics.autoRate}%`, note: `${metrics.auto} auto-approved`, icon: Sparkles },
              { label: "Exceptions surfaced", value: metrics.exceptions, note: "Review or reject", icon: AlertTriangle },
              { label: "Duplicate payments blocked", value: metrics.duplicateBlocks, note: "Hard control", icon: ShieldCheck },
            ].map((item) => <div key={item.label} className="metric-card"><div><p>{item.label}</p><strong>{item.value}</strong><span>{item.note}</span></div><item.icon className="h-5 w-5 text-indigo-600" /></div>)}
          </div>

          <TabsContent value="process" className="mt-0 space-y-6">
            <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
              <section className="surface-card p-5 sm:p-6">
                <div className="mb-5 flex items-start justify-between gap-4"><div><p className="section-kicker">Input</p><h3 className="section-title">Submit an invoice</h3><p className="section-copy">Upload a real PDF for live extraction, or use a guided scenario to inspect a specific control.</p></div>{file && <Button variant="ghost" size="sm" onClick={resetRun}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reset</Button>}</div>
                <label className={`upload-zone ${file ? "upload-zone-active" : ""}`}><input ref={inputRef} type="file" accept="application/pdf" className="sr-only" disabled={running} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><div className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><UploadCloud className="h-6 w-6" /></div>{file ? <><p className="mt-3 max-w-full truncate font-semibold text-slate-900">{file.name}</p><p className="mt-1 text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB · Ready for secure processing</p></> : <><p className="mt-3 font-semibold text-slate-900">Drop or choose an invoice PDF</p><p className="mt-1 text-xs text-slate-500">PDF only · Maximum 8 MB</p></>}<span className="mt-4 inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm">{file ? "Choose another" : "Browse files"}</span></label>
                <Button className="mt-4 h-11 w-full bg-[#172554] hover:bg-[#1e3a8a]" disabled={!file || running} onClick={() => void runWorkflow()}>{running ? <><CircleDot className="mr-2 h-4 w-4 animate-pulse" />Processing invoice</> : <>Run invoice workflow<ArrowRight className="ml-2 h-4 w-4" /></>}</Button>
                <div className="my-5 flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Guided test scenarios</span><div className="h-px flex-1 bg-slate-200" /></div>
                <div className="grid gap-2 sm:grid-cols-2">{SCENARIOS.map((scenario) => <button key={scenario.id} disabled={running} onClick={() => void runWorkflow(scenario.id)} className="scenario-button"><span className={`scenario-icon scenario-${scenario.tone}`}><scenario.icon className="h-4 w-4" /></span><span className="min-w-0 text-left"><strong>{scenario.title}</strong><small>{scenario.note}</small></span><ChevronRight className="ml-auto h-4 w-4 text-slate-400" /></button>)}</div>
                <p className="mt-4 flex gap-2 rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-slate-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Guided scenarios are explicitly labelled test fixtures. They exercise the same matching, controls, decision and audit logic without claiming AI extraction.</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"><span className="font-semibold text-slate-500">Download PDF fixtures:</span><a className="download-link" href="/samples/northwind-inv-20831.pdf" download>Clean</a><a className="download-link" href="/samples/bluepeak-partial-7781.pdf" download>Partial</a><a className="download-link" href="/samples/meridian-tax-inclusive-9012.pdf" download>Tax</a><a className="download-link" href="/samples/northwind-reference-ambiguous.pdf" download>Ambiguous</a></div>
              </section>

              <section className="surface-card overflow-hidden"><div className="border-b border-slate-200 px-5 py-5 sm:px-6"><div className="flex items-center justify-between gap-4"><div><p className="section-kicker">Live execution</p><h3 className="section-title">Workflow run</h3></div><span className={`live-pill ${running ? "live-pill-on" : ""}`}><span />{running ? "Running" : result ? "Completed" : "Ready"}</span></div><div className="mt-4 flex items-center gap-3"><Progress value={progress} className="h-2 flex-1" /><span className="w-9 text-right text-xs font-semibold text-slate-500">{progress}%</span></div></div><div className="p-5 sm:p-6"><div className="relative space-y-0"><div className="absolute bottom-5 left-[15px] top-5 w-px bg-slate-200" />{stages.map((stage, index) => <div key={stage.id} className="relative flex gap-4 pb-5 last:pb-0"><div className={`z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-white ${stage.status === "RUNNING" ? "border-indigo-300 ring-4 ring-indigo-50" : stage.status === "FAILED" ? "border-rose-200" : stage.status === "COMPLETE" ? "border-emerald-200" : "border-slate-200"}`}><StageIcon status={stage.status} /></div><div className="min-w-0 pt-0.5"><div className="flex items-center gap-2"><span className="text-xs font-semibold text-slate-400">0{index + 1}</span><p className="text-sm font-semibold text-slate-900">{stage.label}</p></div><p className={`mt-1 text-xs leading-5 ${stage.status === "FAILED" ? "text-rose-600" : "text-slate-500"}`}>{stage.detail}</p></div></div>)}</div></div></section>
            </div>
            {result && <ResultPanel run={result} />}
          </TabsContent>

          <TabsContent value="history" className="mt-0"><section className="surface-card overflow-hidden"><div className="flex flex-col justify-between gap-3 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-end sm:px-6"><div><p className="section-kicker">Audit trail</p><h3 className="section-title">All workflow runs</h3><p className="section-copy">Inputs, outcomes and processing evidence persist across sessions.</p></div><Button variant="outline" size="sm" onClick={() => void loadRuns()}><RotateCcw className="mr-2 h-3.5 w-3.5" />Refresh</Button></div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Vendor</TableHead><TableHead>PO</TableHead><TableHead>Amount</TableHead><TableHead>Decision</TableHead><TableHead>Source</TableHead><TableHead>Processed</TableHead></TableRow></TableHeader><TableBody>{runs.map((run) => <TableRow key={run.id} className="cursor-pointer" onClick={() => { setResult(run); setStages(run.stages ?? EMPTY_STAGES); setActiveTab("process"); }}><TableCell><div className="font-semibold text-slate-900">{run.invoiceNumber || "Awaiting extraction"}</div><div className="max-w-[180px] truncate text-xs text-slate-500">{run.fileName}</div></TableCell><TableCell>{run.vendorName || "N/A"}</TableCell><TableCell className="font-mono text-xs">{run.poNumber || "N/A"}</TableCell><TableCell>{formatMoney(run.totalCents, run.currency || "USD")}</TableCell><TableCell><DecisionBadge decision={run.decision} /></TableCell><TableCell><Badge variant="outline" className="font-normal">{run.source === "GEMINI_PDF" ? "Live PDF" : "Guided test"}</Badge></TableCell><TableCell className="text-xs text-slate-500">{new Date(run.createdAt).toLocaleString()}</TableCell></TableRow>)}{!historyLoading && runs.length === 0 && <TableRow><TableCell colSpan={7}><div className="grid place-items-center py-14 text-center"><History className="h-8 w-8 text-slate-300" /><p className="mt-3 font-semibold">No runs yet</p><p className="mt-1 text-sm text-slate-500">Process an invoice to create the first audit record.</p></div></TableCell></TableRow>}</TableBody></Table></div></section></TabsContent>

          <TabsContent value="impact" className="mt-0 space-y-6"><div className="grid gap-6 lg:grid-cols-3"><section className="surface-card p-6 lg:col-span-2"><p className="section-kicker">Decision mix</p><h3 className="section-title">Where automation stops</h3><p className="section-copy">A safe workflow is measured by both straight-through processing and the exceptions it catches.</p><div className="mt-7 space-y-5">{(["AUTO_APPROVED", "NEEDS_REVIEW", "REJECTED"] as const).map((decision) => { const count = runs.filter((run) => run.decision === decision).length; const pct = metrics.total ? Math.round((count / metrics.total) * 100) : 0; return <div key={decision}><div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold">{decisionMeta[decision].label}</span><span className="text-slate-500">{count} · {pct}%</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${decision === "AUTO_APPROVED" ? "bg-emerald-500" : decision === "NEEDS_REVIEW" ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${pct}%` }} /></div></div>; })}</div></section><section className="surface-card p-6"><p className="section-kicker">Operating view</p><h3 className="section-title">Value signals</h3><div className="mt-6 space-y-5"><ValueSignal label="Average workflow time" value={formatDuration(metrics.avgMs)} note="Measured across completed runs" icon={Clock3} /><ValueSignal label="Estimated time returned" value={`${Math.max(0, metrics.total * 8)} min`} note="Assumption: 8 manual minutes per invoice" icon={Sparkles} /><ValueSignal label="Hard-control saves" value={metrics.duplicateBlocks.toString()} note="Potential repeat payments prevented" icon={ShieldCheck} /></div></section></div><section className="surface-card p-6"><div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]"><div><p className="section-kicker">Measurement notes</p><h3 className="section-title">Numbers with context</h3><p className="section-copy">Time saved is an estimate, not a financial claim. Decision counts and processing duration come from the actual run log.</p></div><div className="grid gap-3 sm:grid-cols-3"><Assumption title="Baseline" body="8 minutes of manual AP review per invoice." /><Assumption title="Automation" body="Only auto-approved runs count as straight-through." /><Assumption title="Guardrail" body="Review and rejection are successful outcomes when risk is real." /></div></div></section></TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function ResultPanel({ run }: { run: Run }) {
  if (!run.decision) return null;
  const meta = decisionMeta[run.decision]; const Icon = meta.icon; const extraction = run.extraction;
  return <section className="surface-card overflow-hidden"><div className={`grid gap-6 border-b p-5 sm:p-6 lg:grid-cols-[1fr_auto] ${meta.shell}`}><div className="flex gap-4"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/80 ${meta.text}`}><Icon className="h-6 w-6" /></div><div><p className={`text-xs font-bold uppercase tracking-[0.18em] ${meta.text}`}>Decision</p><h3 className="mt-1 text-2xl font-bold tracking-tight">{meta.label}</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">{run.reason}</p></div></div><div className="flex items-end gap-6 lg:text-right"><div><p className="text-xs text-slate-500">Total</p><p className="mt-1 text-xl font-bold">{formatMoney(run.totalCents, run.currency || "USD")}</p></div><div><p className="text-xs text-slate-500">Run time</p><p className="mt-1 text-xl font-bold">{formatDuration(run.processingMs)}</p></div></div></div><div className="grid lg:grid-cols-[0.85fr_1.15fr]"><div className="border-b border-slate-200 p-5 sm:p-6 lg:border-b-0 lg:border-r"><p className="section-kicker">Extracted evidence</p><div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4"><Field label="Vendor" value={extraction?.vendorName} /><Field label="Invoice number" value={extraction?.invoiceNumber} mono /><Field label="PO reference" value={extraction?.poNumber} mono /><Field label="Invoice date" value={extraction?.invoiceDate} /><Field label="Subtotal" value={extraction?.subtotal === null || extraction?.subtotal === undefined ? null : formatMoney(Math.round(extraction.subtotal * 100), extraction.currency || "USD")} /><Field label="Tax" value={extraction?.tax === null || extraction?.tax === undefined ? null : formatMoney(Math.round(extraction.tax * 100), extraction.currency || "USD")} /><Field label="Extraction confidence" value={extraction?.extractionConfidence} /><Field label="Source" value={run.source === "GEMINI_PDF" ? "Live PDF extraction" : "Guided test fixture"} /></div>{extraction?.warnings && extraction.warnings.length > 0 && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-800">Extraction notes</p>{extraction.warnings.map((warning) => <p key={warning} className="mt-1 text-xs leading-5 text-amber-700">• {warning}</p>)}</div>}</div><div className="p-5 sm:p-6"><div className="flex items-center justify-between"><p className="section-kicker">Control results</p><span className="text-xs text-slate-500">{run.checks?.filter((check) => check.status === "PASS").length ?? 0}/{run.checks?.length ?? 0} passed</span></div><div className="mt-4 space-y-3">{run.checks?.map((check) => <div key={check.id} className="flex gap-3 rounded-xl border border-slate-200 p-3.5"><div className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${check.status === "PASS" ? "bg-emerald-50 text-emerald-600" : check.status === "WARN" ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"}`}>{check.status === "PASS" ? <CheckCircle2 className="h-4 w-4" /> : check.status === "WARN" ? <AlertTriangle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}</div><div><div className="flex items-center gap-2"><p className="text-sm font-semibold">{check.label}</p><span className={`text-[10px] font-bold ${check.status === "PASS" ? "text-emerald-600" : check.status === "WARN" ? "text-amber-600" : "text-rose-600"}`}>{check.status}</span></div><p className="mt-1 text-xs leading-5 text-slate-500">{check.detail}</p></div></div>)}</div></div></div></section>;
}
function Field({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) { return <div><p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p><p className={`mt-1 text-sm font-semibold text-slate-800 ${mono ? "font-mono" : ""}`}>{value || "Not found"}</p></div>; }
function ValueSignal({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Clock3 }) { return <div className="flex gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><Icon className="h-4 w-4" /></div><div><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-bold">{value}</p><p className="text-[11px] text-slate-400">{note}</p></div></div>; }
function Assumption({ title, body }: { title: string; body: string }) { return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold text-slate-700">{title}</p><p className="mt-1.5 text-xs leading-5 text-slate-500">{body}</p></div>; }
