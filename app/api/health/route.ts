import { checkDatabase } from "../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY"].filter(
    (name) => !process.env[name],
  );
  if (missing.length) {
    return Response.json({ ok: false, missing }, { status: 503 });
  }

  try {
    await checkDatabase();
    return Response.json({ ok: true, database: "connected", extraction: "configured" });
  } catch (error) {
    return Response.json(
      { ok: false, database: "unavailable", error: error instanceof Error ? error.message : "Health check failed" },
      { status: 503 },
    );
  }
}
