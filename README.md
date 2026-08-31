# LedgerFlow

LedgerFlow is an explainable invoice-to-payment decision workflow built for the Zamp AI Solutions Analyst case study. It accepts invoice PDFs, extracts structured fields with Gemini, applies deterministic AP controls, routes exceptions, and stores a complete run history in Supabase.

## What the workflow demonstrates

- Live PDF extraction with Gemini 3.5 Flash-Lite
- Required-field, PO, vendor, currency, arithmetic, tolerance, tax and line-item checks
- Three explicit outcomes: `AUTO_APPROVED`, `NEEDS_REVIEW`, and `REJECTED`
- Atomic duplicate detection that remains safe when requests run concurrently
- A live execution rail, explainable evidence, audit history, and impact metrics
- Four guided scenarios and four downloadable synthetic invoice PDFs

## Architecture

The browser sends a PDF or guided scenario to a Next.js route handler. The handler streams stage events back to the interface, calls Gemini only for real PDFs, applies deterministic rules, and writes the audit record through Supabase REST. Supabase credentials and the Gemini key stay in the server runtime.

## 1. Create the Supabase database

1. Create a free project at [Supabase](https://supabase.com/dashboard).
2. Open **SQL Editor** and create a new query.
3. Paste and run [`supabase/migrations/001_ledgerflow.sql`](supabase/migrations/001_ledgerflow.sql).
4. Open **Project Settings > API** and copy:
   - Project URL
   - `service_role` key, not the public anon key

The migration enables row-level security and gives no browser role direct table access. The service key is used only by server-side route handlers.

## 2. Create the Gemini key

Create a free key in [Google AI Studio](https://aistudio.google.com/app/apikey). Use only synthetic invoices for the case study. Free-tier data handling may not be suitable for real customer invoices.

## 3. Run locally

Requirements: Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local
```

Fill `.env.local`:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
GEMINI_API_KEY=YOUR_GEMINI_KEY
```

Then run:

```bash
npm run dev
```

Open `http://localhost:3000`. Check `http://localhost:3000/api/health` before testing a PDF.

## 4. Deploy on Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, select **Add New > Project** and import the repository.
3. Keep the detected framework as **Next.js**.
4. Add these server-side environment variables for Production:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY`
5. Deploy.
6. Open `https://YOUR_DOMAIN/api/health`. A ready deployment returns:

```json
{"ok":true,"database":"connected","extraction":"configured"}
```

If you add or change an environment variable after deployment, redeploy so the new value is available to the application.

## 5. Submission smoke test

Run this exact sequence before recording:

1. Open Supabase Table Editor and clear any previous test rows if you want a clean dashboard.
2. Upload `public/samples/northwind-inv-20831.pdf`. It should auto-approve.
3. Upload the same PDF again. It should reject it as a duplicate.
4. Upload `public/samples/northwind-reference-ambiguous.pdf`. It should route to human review.
5. Open **Run history** and confirm all three runs are visible.
6. Open **Impact** and confirm the counts reflect the decisions.

Guided scenario buttons use transparent fixtures. Uploading the sample PDFs exercises live Gemini extraction.

## Security notes

- Never commit `.env.local`.
- Never expose the service role key or Gemini key with a `NEXT_PUBLIC_` prefix.
- Do not use real company invoices with free-tier AI services.
- Rotate a key immediately if it appears in Git history, screenshots, chat, or a recording.
- The app validates the PDF signature and limits uploads to 8 MB.

## Commands

```bash
npm run dev
npm run lint
npm test
npm run build
npm start
```

## Important assumptions

- The PO master is a deterministic in-code fixture so the assignment remains reproducible.
- An 8-minute manual baseline is used only for estimated time returned. It is labelled as an assumption in the interface.
- Review and rejection are valuable workflow outcomes, not failures of automation.
- Failed attempts do not permanently block a later retry with the same invoice identity.
