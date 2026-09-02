import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("keeps invoice processing focused on the primary task", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /title: "New invoice"/);
  assert.match(page, /Synthetic demo data/);
  assert.match(page, /<details className="demo-cases">/);
  assert.doesNotMatch(page, /Make every invoice decision traceable/);
  assert.doesNotMatch(page, /Accounts payable workspace/);
});

test("estimates time avoided from auto-approved invoices only", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /metrics\.auto \* 8/);
  assert.doesNotMatch(page, /metrics\.total \* 8/);
});
