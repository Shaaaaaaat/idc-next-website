import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

type AfterTask = () => void | Promise<void>;

const require = createRequire(import.meta.url);
const nextServer = require("next/server") as { after: (task: AfterTask) => void };
const originalAfter = nextServer.after;
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const originalDateNow = Date.now;

let activeFetch: typeof fetch = originalFetch;
let afterTasks: AfterTask[] = [];
const unexpectedFetches: string[] = [];

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  return activeFetch(input, init);
}) as typeof fetch;

function installAfterCapture() {
  afterTasks = [];
  nextServer.after = (task: AfterTask) => {
    afterTasks.push(task);
  };
}

async function runAfterTasks() {
  const tasks = [...afterTasks];
  afterTasks = [];
  for (const task of tasks) {
    await task();
  }
}

function restoreGlobals() {
  activeFetch = originalFetch;
  afterTasks = [];
  nextServer.after = originalAfter;
  Date.now = originalDateNow;
  process.env = { ...originalEnv };
}

function setupRuntimeTest(t: TestContext) {
  unexpectedFetches.length = 0;
  t.after(() => {
    try {
      assert.deepEqual(unexpectedFetches, []);
    } finally {
      restoreGlobals();
    }
  });
}

function setStrictFetch(calls: FetchCall[], handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  activeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formRequest(url: string, params: URLSearchParams) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function failUnexpectedFetch(url: string): never {
  unexpectedFetches.push(url);
  throw new Error(`unexpected fetch: ${url}`);
}

function setupSupabaseEnv(flag: "write_leads" | "write_purchases") {
  process.env.SUPABASE_ENABLED = "true";
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  if (flag === "write_leads") process.env.SUPABASE_WRITE_LEADS = "true";
  if (flag === "write_purchases") process.env.SUPABASE_WRITE_PURCHASES = "true";
}

function leadBody() {
  return {
    fullName: "Test User",
    phone: "+79990000000",
    email: "test@example.com",
    city: "Москва",
    studio: "м. Октябрьская",
  };
}

function createPaymentBody() {
  return {
    amount: 12000,
    currency: "RUB",
    email: "buyer@example.com",
    phone: "+79990000000",
    fullName: "Buyer User",
    courseName: "classic",
    tariffId: "short12",
    tariffLabel: "12 тренировок",
  };
}

function robokassaParams(invId: string, outSum = "12000.00", secret = "secret2") {
  const signature = crypto.createHash("md5").update(`${outSum}:${invId}:${secret}`).digest("hex");
  return new URLSearchParams({ OutSum: outSum, InvId: invId, SignatureValue: signature });
}

test("leads/create keeps YDB first and required Supabase write without external calls", async (t) => {
  setupRuntimeTest(t);
  setupSupabaseEnv("write_leads");
  process.env.YDB_CF_URL = "https://ydb.test/leads";
  process.env.CF_INTERNAL_TOKEN = "internal-token";

  const calls: FetchCall[] = [];
  setStrictFetch(calls, (url) => {
    if (url === "https://ydb.test/leads") {
      return jsonResponse({ ok: true, ydb_id: "lead-ydb-id" });
    }
    if (url === "https://supabase.test/rest/v1/leads_raw") {
      return jsonResponse({}, 201);
    }
    return failUnexpectedFetch(url);
  });

  const { POST } = await import("./leads/create/route");
  const response = await POST(jsonRequest("http://localhost/api/leads/create", leadBody()));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(calls.map((call) => call.url), [
    "https://ydb.test/leads",
    "https://supabase.test/rest/v1/leads_raw",
  ]);
});

test("leads/create still writes Supabase when YDB fails", async (t) => {
  setupRuntimeTest(t);
  setupSupabaseEnv("write_leads");
  process.env.YDB_CF_URL = "https://ydb.test/leads";

  const calls: FetchCall[] = [];
  setStrictFetch(calls, (url) => {
    if (url === "https://ydb.test/leads") {
      return jsonResponse({ ok: false }, 500);
    }
    if (url === "https://supabase.test/rest/v1/leads_raw") {
      return jsonResponse({}, 201);
    }
    return failUnexpectedFetch(url);
  });

  const { POST } = await import("./leads/create/route");
  const response = await POST(jsonRequest("http://localhost/api/leads/create", leadBody()));

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://ydb.test/leads",
    "https://supabase.test/rest/v1/leads_raw",
  ]);
});

test("leads/create returns 502 when required Supabase write fails", async (t) => {
  setupRuntimeTest(t);
  setupSupabaseEnv("write_leads");
  process.env.YDB_CF_URL = "https://ydb.test/leads";

  const calls: FetchCall[] = [];
  setStrictFetch(calls, (url) => {
    if (url === "https://ydb.test/leads") {
      return jsonResponse({ ok: true, ydb_id: "lead-ydb-id" });
    }
    if (url === "https://supabase.test/rest/v1/leads_raw") {
      return jsonResponse({ message: "insert failed" }, 500);
    }
    return failUnexpectedFetch(url);
  });

  const { POST } = await import("./leads/create/route");
  const response = await POST(jsonRequest("http://localhost/api/leads/create", leadBody()));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Не удалось сохранить заявку. Попробуйте ещё раз." });
});

test("create-payment returns payment response after required Supabase write", async (t) => {
  setupRuntimeTest(t);
  installAfterCapture();
  setupSupabaseEnv("write_purchases");
  process.env.ROBO_ID = "merchant";
  process.env.ROBO_SECRET1 = "secret1";
  process.env.YDB_CF_URL = "https://ydb.test/payment";
  process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
  process.env.TELEGRAM_CHAT_ID = "100500";
  Date.now = () => 1700000000000;

  const calls: FetchCall[] = [];
  setStrictFetch(calls, (url, init) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "GET") {
      return jsonResponse(null);
    }
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "POST") {
      return jsonResponse([]);
    }
    if (url === "https://ydb.test/payment") {
      return jsonResponse({ ok: true, ydb_id: "payment-ydb-id" });
    }
    if (url === "https://api.telegram.org/bottelegram-token/sendMessage") {
      return jsonResponse({ ok: true });
    }
    return failUnexpectedFetch(url);
  });

  const { POST } = await import("./create-payment/route");
  const response = await POST(jsonRequest("http://localhost/api/create-payment", createPaymentBody()));
  await runAfterTasks();

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.paymentUrl, "string");
  assert.match(body.paymentUrl, /^https:\/\/auth\.robokassa\.ru\/Merchant\/Index\.aspx/);
  assert.match(body.paymentUrl, /InvId=1700000000000/);
  assert.ok(calls.some((call) => call.url.startsWith("https://supabase.test/rest/v1/purchases")));
  assert.ok(calls.some((call) => call.url === "https://ydb.test/payment"));
  assert.ok(calls.some((call) => call.url === "https://api.telegram.org/bottelegram-token/sendMessage"));
});

test("create-payment returns previous error when required Supabase write fails", async (t) => {
  setupRuntimeTest(t);
  installAfterCapture();
  setupSupabaseEnv("write_purchases");
  process.env.ROBO_ID = "merchant";
  process.env.ROBO_SECRET1 = "secret1";
  Date.now = () => 1700000000000;

  const calls: FetchCall[] = [];
  setStrictFetch(calls, (url, init) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "GET") {
      return jsonResponse(null);
    }
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "POST") {
      return jsonResponse({ message: "upsert failed" }, 500);
    }
    return failUnexpectedFetch(url);
  });

  const { POST } = await import("./create-payment/route");
  const response = await POST(jsonRequest("http://localhost/api/create-payment", createPaymentBody()));
  await runAfterTasks();

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Не удалось создать оплату. Попробуйте ещё раз." });
  assert.equal(calls.some((call) => call.url === "https://ydb.test/payment"), false);
  assert.equal(calls.some((call) => call.url.includes("api.telegram.org")), false);
});

test("create-payment YDB failure does not block active Telegram notification", async (t) => {
  setupRuntimeTest(t);
  installAfterCapture();
  setupSupabaseEnv("write_purchases");
  process.env.ROBO_ID = "merchant";
  process.env.ROBO_SECRET1 = "secret1";
  process.env.YDB_CF_URL = "https://ydb.test/payment";
  process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
  process.env.TELEGRAM_CHAT_ID = "100500";
  Date.now = () => 1700000000000;

  const calls: FetchCall[] = [];
  setStrictFetch(calls, (url, init) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "GET") {
      return jsonResponse(null);
    }
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "POST") {
      return jsonResponse([]);
    }
    if (url === "https://ydb.test/payment") {
      return jsonResponse({ ok: false }, 500);
    }
    if (url === "https://api.telegram.org/bottelegram-token/sendMessage") {
      return jsonResponse({ ok: true });
    }
    return failUnexpectedFetch(url);
  });

  const { POST } = await import("./create-payment/route");
  const response = await POST(jsonRequest("http://localhost/api/create-payment", createPaymentBody()));
  await runAfterTasks();

  assert.equal(response.status, 200);
  assert.ok(calls.some((call) => call.url === "https://ydb.test/payment"));
  assert.ok(calls.some((call) => call.url === "https://api.telegram.org/bottelegram-token/sendMessage"));
});

test("robokassa/result rejects bad signature without Supabase processing", async (t) => {
  setupRuntimeTest(t);
  installAfterCapture();
  setupSupabaseEnv("write_purchases");
  process.env.ROBO_SECRET2 = "secret2";
  process.env.IDC_ERRORS_BOT_TOKEN = "errors-token";
  process.env.IDC_ERRORS_CHAT_ID = "777";

  const calls: FetchCall[] = [];
  setStrictFetch(calls, (url) => failUnexpectedFetch(url));

  const { POST } = await import("./robokassa/result/route");
  const params = robokassaParams("123");
  params.set("SignatureValue", "bad-signature");
  const response = await POST(formRequest("http://localhost/api/robokassa/result", params) as Parameters<typeof POST>[0]);
  await runAfterTasks();

  assert.equal(response.status, 400);
  assert.equal(await response.text(), "bad signature");
  assert.equal(calls.length, 0);
});

test("robokassa/result keeps Supabase processing and OK response for valid signature", async (t) => {
  setupRuntimeTest(t);
  installAfterCapture();
  setupSupabaseEnv("write_purchases");
  process.env.ROBO_SECRET2 = "secret2";
  process.env.YDB_CF_URL = "https://ydb.test/paid-status";

  const calls: FetchCall[] = [];
  setStrictFetch(calls, (url, init) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "GET") {
      return jsonResponse({ id: "purchase-id", status: "Created" });
    }
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "PATCH") {
      return jsonResponse([]);
    }
    if (url.startsWith("https://supabase.test/rest/v1/rpc/process_paid_purchase")) {
      return jsonResponse({ ok: true, status: "processed" });
    }
    if (url === "https://ydb.test/paid-status") {
      return jsonResponse({ ok: true });
    }
    return failUnexpectedFetch(url);
  });

  const { POST } = await import("./robokassa/result/route");
  const response = await POST(
    formRequest("http://localhost/api/robokassa/result", robokassaParams("123")) as Parameters<typeof POST>[0]
  );
  await runAfterTasks();

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "OK123");
  assert.ok(calls.some((call) => call.url.startsWith("https://supabase.test/rest/v1/purchases")));
  assert.ok(calls.some((call) => call.url.startsWith("https://supabase.test/rest/v1/rpc/process_paid_purchase")));
});

test("robokassa/result sends existing alert for purchase_not_found and keeps OK", async (t) => {
  setupRuntimeTest(t);
  installAfterCapture();
  setupSupabaseEnv("write_purchases");
  process.env.ROBO_SECRET2 = "secret2";
  process.env.IDC_ERRORS_BOT_TOKEN = "errors-token";
  process.env.IDC_ERRORS_CHAT_ID = "777";

  const calls: FetchCall[] = [];
  setStrictFetch(calls, (url, init) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "GET") {
      return jsonResponse(null);
    }
    if (url === "https://api.telegram.org/boterrors-token/sendMessage") {
      return jsonResponse({ ok: true });
    }
    return failUnexpectedFetch(url);
  });

  const { POST } = await import("./robokassa/result/route");
  const response = await POST(
    formRequest("http://localhost/api/robokassa/result", robokassaParams("404")) as Parameters<typeof POST>[0]
  );
  await runAfterTasks();

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "OK404");
  assert.ok(calls.some((call) => call.url === "https://api.telegram.org/boterrors-token/sendMessage"));
});

test("robokassa/result YDB failure does not change main OK response", async (t) => {
  setupRuntimeTest(t);
  installAfterCapture();
  setupSupabaseEnv("write_purchases");
  process.env.ROBO_SECRET2 = "secret2";
  process.env.YDB_CF_URL = "https://ydb.test/paid-status";

  const calls: FetchCall[] = [];
  setStrictFetch(calls, (url, init) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "GET") {
      return jsonResponse({ id: "purchase-id", status: "Created" });
    }
    if (url.startsWith("https://supabase.test/rest/v1/purchases") && method === "PATCH") {
      return jsonResponse([]);
    }
    if (url.startsWith("https://supabase.test/rest/v1/rpc/process_paid_purchase")) {
      return jsonResponse({ ok: true, status: "processed" });
    }
    if (url === "https://ydb.test/paid-status") {
      return jsonResponse({ ok: false }, 500);
    }
    return failUnexpectedFetch(url);
  });

  const { POST } = await import("./robokassa/result/route");
  const response = await POST(
    formRequest("http://localhost/api/robokassa/result", robokassaParams("124")) as Parameters<typeof POST>[0]
  );
  await runAfterTasks();

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "OK124");
  assert.ok(calls.some((call) => call.url === "https://ydb.test/paid-status"));
});

test("yookassa/result keeps provider verification and Supabase confirmation without external sync", async (t) => {
  setupRuntimeTest(t);
  setupSupabaseEnv("write_purchases");
  process.env.YOOKASSA_SHOP_ID = "shop-123";
  process.env.YOOKASSA_SECRET_KEY = "secret-key";

  const paymentId = "2e6a10c1-45e0-4c60-bd9f-58c13d9a53d9";
  const purchaseId = "7c062dc9-7f68-4ad2-b8d2-d46ae85f4b13";
  const calls: FetchCall[] = [];

  setStrictFetch(calls, (url) => {
    if (url === `https://api.yookassa.ru/v3/payments/${paymentId}`) {
      return jsonResponse({
        id: paymentId,
        status: "succeeded",
        amount: { value: "12000.00", currency: "RUB" },
        recipient: { account_id: "shop-123" },
        metadata: { orderId: purchaseId },
      });
    }
    if (url.startsWith("https://supabase.test/rest/v1/rpc/confirm_yookassa_purchase")) {
      return jsonResponse({ ok: true, purchase_id: purchaseId, status: "Paid" });
    }
    return failUnexpectedFetch(url);
  });

  const { POST } = await import("./yookassa/result/route");
  const request = jsonRequest("http://localhost/api/yookassa/result", {
    event: "payment.succeeded",
    object: { id: paymentId },
  }) as Parameters<typeof POST>[0];
  const response = await POST(request);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, purchase_id: purchaseId, status: "Paid" });
  assert.deepEqual(calls.map((call) => call.url), [
    `https://api.yookassa.ru/v3/payments/${paymentId}`,
    calls[1].url,
  ]);
  assert.ok(calls[1].url.startsWith("https://supabase.test/rest/v1/rpc/confirm_yookassa_purchase"));
});
