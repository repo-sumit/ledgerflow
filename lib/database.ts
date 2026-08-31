type RunInsert = {
  id: string;
  created_at: string;
  file_name: string;
  source: string;
  status: string;
  stages: unknown;
};

type RunUpdate = Partial<{
  completed_at: string;
  status: string;
  decision: string;
  vendor_name: string | null;
  vendor_key: string;
  invoice_number: string | null;
  invoice_key: string;
  po_number: string | null;
  currency: string | null;
  total_cents: number | null;
  reason: string;
  processing_ms: number;
  extraction: unknown;
  checks: unknown;
  stages: unknown;
}>;

export type StoredRun = {
  id: string;
  created_at: string;
  completed_at: string | null;
  file_name: string;
  source: string;
  status: string;
  decision: string | null;
  vendor_name: string | null;
  vendor_key: string | null;
  invoice_number: string | null;
  invoice_key: string | null;
  po_number: string | null;
  currency: string | null;
  total_cents: number | null;
  reason: string | null;
  processing_ms: number | null;
  extraction: unknown;
  checks: unknown;
  stages: unknown;
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return { url, serviceRoleKey };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, serviceRoleKey } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Database request failed (${response.status}): ${detail.slice(0, 220)}`);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function insertRun(run: RunInsert) {
  await request<void>("runs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(run),
  });
}

export async function reserveInvoiceIdentity(runId: string, vendorKey: string, invoiceKey: string) {
  return request<boolean>("rpc/reserve_invoice_identity", {
    method: "POST",
    body: JSON.stringify({ p_run_id: runId, p_vendor_key: vendorKey, p_invoice_key: invoiceKey }),
  });
}

export async function updateRun(runId: string, values: RunUpdate) {
  await request<void>(`runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(values),
  });
}

export async function listRuns() {
  return request<StoredRun[]>("runs?select=*&order=created_at.desc&limit=50");
}

export async function checkDatabase() {
  await request<Pick<StoredRun, "id">[]>("runs?select=id&limit=1");
}
