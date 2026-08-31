import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses final LedgerFlow metadata and removes starter preview markers", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /title:\s*"LedgerFlow - Invoice Decisioning"/);
  assert.match(layout, /Explainable invoice controls/);
  assert.doesNotMatch(layout, /codex-preview|Starter Project/);
});
