create table if not exists public.runs (
  id uuid primary key,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  file_name text not null,
  source text not null check (source in ('GUIDED_SCENARIO', 'GEMINI_PDF')),
  status text not null check (status in ('PROCESSING', 'COMPLETED', 'FAILED')),
  decision text check (decision is null or decision in ('AUTO_APPROVED', 'NEEDS_REVIEW', 'REJECTED')),
  vendor_name text,
  vendor_key text,
  invoice_number text,
  invoice_key text,
  po_number text,
  currency text,
  total_cents bigint,
  reason text,
  processing_ms integer,
  extraction jsonb,
  checks jsonb,
  stages jsonb not null default '[]'::jsonb
);

create index if not exists runs_created_at_idx on public.runs (created_at desc);
create index if not exists runs_invoice_identity_idx on public.runs (vendor_key, invoice_key)
  where vendor_key is not null and invoice_key is not null;

alter table public.runs enable row level security;

create or replace function public.reserve_invoice_identity(
  p_run_id uuid,
  p_vendor_key text,
  p_invoice_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  duplicate_found boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_vendor_key || ':' || p_invoice_key, 0));

  select exists (
    select 1
    from public.runs
    where id <> p_run_id
      and vendor_key = p_vendor_key
      and invoice_key = p_invoice_key
      and status <> 'FAILED'
  ) into duplicate_found;

  update public.runs
  set vendor_key = p_vendor_key,
      invoice_key = p_invoice_key
  where id = p_run_id;

  return duplicate_found;
end;
$$;

revoke all on function public.reserve_invoice_identity(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_invoice_identity(uuid, text, text) to service_role;
