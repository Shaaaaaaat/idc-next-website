import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

const routePaths = [
  "src/app/api/leads/create/route.ts",
  "src/app/api/create-payment/route.ts",
  "src/app/api/robokassa/result/route.ts",
  "src/app/api/yookassa/result/route.ts",
] as const;

function source(path: (typeof routePaths)[number]) {
  return readFileSync(join(root, path), "utf8");
}

function assertNoAirtable(path: (typeof routePaths)[number]) {
  const text = source(path);
  assert.equal(text.includes("api.airtable.com"), false, `${path} must not call Airtable API`);
  assert.equal(/\bAIRTABLE_[A-Z0-9_]+\b/.test(text), false, `${path} must not read Airtable env`);
  assert.equal(/airtable/i.test(text), false, `${path} must not keep Airtable helpers or payloads`);
}

test("target routes no longer contain Airtable calls, env reads, helpers, or payloads", () => {
  for (const path of routePaths) {
    assertNoAirtable(path);
  }
});

test("leads route still attempts YDB first and preserves required Supabase failure response", () => {
  const text = source("src/app/api/leads/create/route.ts");
  const ydbIndex = text.indexOf("await postToYdbCF({");
  const supabaseIndex = text.indexOf("await createLeadInSupabase({");

  assert.ok(ydbIndex > -1, "YDB lead attempt must remain");
  assert.ok(supabaseIndex > -1, "Supabase lead write must remain");
  assert.ok(ydbIndex < supabaseIndex, "YDB lead attempt must remain before Supabase write");
  assert.ok(text.includes('reason: "cf_timeout"'), "YDB timeout handling must remain");
  assert.ok(text.includes('status: 502'), "Supabase lead write errors must still block response");
});

test("create-payment route still writes Supabase purchase and schedules YDB/Telegram mirrors", () => {
  const text = source("src/app/api/create-payment/route.ts");

  assert.ok(text.includes("await upsertPurchaseCreated({"), "Supabase purchase write must remain");
  assert.ok(text.includes("status: 502"), "Supabase purchase write errors must still block response");
  assert.ok(text.includes("await postToYdbCF(ydbPaymentPayload)"), "YDB payment mirror must remain");
  assert.ok(text.includes("await sendTelegramMessage(telegramInvoiceText"), "active Telegram invoice notification must remain");
  assert.ok(text.includes("generatePaymentLink("), "Robokassa payment link creation must remain");
});

test("Robokassa route keeps Supabase processing, alert, and OK response without legacy lookup", () => {
  const text = source("src/app/api/robokassa/result/route.ts");

  assert.ok(text.includes("await markPurchasePaidAndProcess(invId)"), "Supabase mark/process must remain");
  assert.ok(text.includes("sendPurchaseNotFoundAlert"), "purchase-not-found alert must remain");
  assert.ok(text.includes('foundSource: "none"'), "legacy Airtable-only branch must no longer determine alert source");
  assert.ok(text.includes("return new NextResponse(okText(String(invId))"), "current Robokassa OK response must remain");
});

test("YooKassa route keeps provider verification and Supabase confirmation only", () => {
  const text = source("src/app/api/yookassa/result/route.ts");

  assert.ok(text.includes("await fetchYooKassaPayment(paymentId"), "YooKassa API verification must remain");
  assert.ok(text.includes("await confirmSupabasePurchase(verified.payment"), "Supabase confirmation must remain");
  assert.ok(text.includes('return json({ ok: true, purchase_id: verified.payment.purchaseId, status: confirmed.status })'), "success response contract must remain");
});
