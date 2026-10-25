import assert from "node:assert/strict";
import test from "node:test";

import {
  handleCheckPaymentRequest,
  type CheckPaymentSupabaseClient,
  type PurchaseStatusRow,
  type SupabaseLookupError,
} from "./check-payment";

type MockRow = PurchaseStatusRow & {
  id_payment?: string | null;
};

type MockError = SupabaseLookupError | null;
type Call = { method: string; args: unknown[] };

const EXPECTED_SELECT =
  "status, tg_link_token, tariff_label, tag, currency, sum, course_name, payment_provider, source_channel";
const EXPECTED_PROVIDER_FILTER =
  "payment_provider.eq.robokassa,payment_provider.is.null,payment_provider.eq.";

const allowedWebsiteProviders = ["robokassa", null, ""];

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/check-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function paidFixture(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id_payment: "same-id",
    status: "Paid",
    tg_link_token: "tg-token",
    tariff_label: "package_12_short",
    tag: "short12",
    currency: "RUB",
    sum: "12000.00",
    course_name: "ds_rub_classic",
    payment_provider: "robokassa",
    source_channel: "website",
    ...overrides,
  };
}

function pendingFixture(overrides: Partial<MockRow> = {}): MockRow {
  return paidFixture({
    status: "Matched",
    sum: 12000,
    ...overrides,
  });
}

function createMockSupabase(options: { fixtures?: MockRow[]; error?: MockError }) {
  const calls: Call[] = [];
  const eqFilters: Record<string, string> = {};
  let providerFilter = "";

  const builder = {
    select(columns: string) {
      calls.push({ method: "select", args: [columns] });
      return builder;
    },
    eq(column: string, value: string) {
      calls.push({ method: "eq", args: [column, value] });
      eqFilters[column] = value;
      return builder;
    },
    or(filter: string) {
      calls.push({ method: "or", args: [filter] });
      providerFilter = filter;
      return builder;
    },
    async maybeSingle() {
      calls.push({ method: "maybeSingle", args: [] });
      if (options.error) return { data: null, error: options.error };

      const data =
        (options.fixtures ?? []).find((row) => {
          const providerAllowed =
            providerFilter === EXPECTED_PROVIDER_FILTER &&
            allowedWebsiteProviders.includes(row.payment_provider ?? null);
          return (
            row.id_payment === eqFilters.id_payment &&
            row.source_channel === eqFilters.source_channel &&
            providerAllowed
          );
        }) ?? null;

      return { data, error: null };
    },
  };

  const client: CheckPaymentSupabaseClient = {
    from(table: "purchases") {
      calls.push({ method: "from", args: [table] });
      return builder;
    },
  };

  return { client, calls };
}

function assertExpectedQuery(calls: Call[], paymentId: string) {
  assert.deepEqual(calls, [
    { method: "from", args: ["purchases"] },
    { method: "select", args: [EXPECTED_SELECT] },
    { method: "eq", args: ["id_payment", paymentId] },
    { method: "eq", args: ["source_channel", "website"] },
    { method: "or", args: [EXPECTED_PROVIDER_FILTER] },
    { method: "maybeSingle", args: [] },
  ]);
}

function assertPendingWithoutPurchaseData(body: Record<string, unknown>, paymentId: string) {
  assert.deepEqual(body, {
    ok: true,
    paid: false,
    status: "pending",
    tgToken: null,
    purchasePayload: {
      transaction_id: paymentId,
      value: 0,
    },
  });
}

test("returns paid response and maps purchase payload fields", async () => {
  const { client, calls } = createMockSupabase({ fixtures: [paidFixture()] });

  const response = await handleCheckPaymentRequest(jsonRequest({ paymentId: "same-id" }), client);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assertExpectedQuery(calls, "same-id");

  const body = await readJson(response);
  assert.equal(body.ok, true);
  assert.equal(body.paid, true);
  assert.equal(body.status, "paid");
  assert.equal(body.tgToken, "tg-token");
  assert.deepEqual(body.purchasePayload, {
    transaction_id: "same-id",
    tariff_label: "package_12_short",
    tag: "short12",
    currency: "RUB",
    value: 12000,
    course_name: "ds_rub_classic",
  });
});

test("accepts current website Robokassa provider compatibility cases", async () => {
  for (const provider of allowedWebsiteProviders) {
    const { client } = createMockSupabase({
      fixtures: [paidFixture({ payment_provider: provider })],
    });

    const body = await readJson(
      await handleCheckPaymentRequest(jsonRequest({ paymentId: "same-id" }), client)
    );

    assert.equal(body.paid, true);
    assert.equal(body.tgToken, "tg-token");
  }
});

test("returns pending response for non-paid purchase without expanding Matched", async () => {
  const { client } = createMockSupabase({
    fixtures: [pendingFixture()],
  });

  const body = await readJson(
    await handleCheckPaymentRequest(jsonRequest({ paymentId: "same-id" }), client)
  );
  assert.equal(body.ok, true);
  assert.equal(body.paid, false);
  assert.equal(body.status, "pending");
  assert.equal(body.tgToken, "tg-token");
});

test("returns pending response when purchase is not found", async () => {
  const { client } = createMockSupabase({ fixtures: [] });

  const body = await readJson(await handleCheckPaymentRequest(jsonRequest({ paymentId: "missing" }), client));
  assertPendingWithoutPurchaseData(body, "missing");
});

test("returns pending without leaking data for provider, source, or id mismatches", async () => {
  const blockedRows: MockRow[] = [
    paidFixture({
      payment_provider: "yookassa",
      tg_link_token: "yookassa-token",
      tariff_label: "yookassa-package",
    }),
    paidFixture({
      source_channel: "bot",
      tg_link_token: "bot-token",
      tariff_label: "bot-package",
    }),
    paidFixture({
      id_payment: "other-id",
      tg_link_token: "other-id-token",
      tariff_label: "other-id-package",
    }),
  ];

  for (const row of blockedRows) {
    const { client } = createMockSupabase({ fixtures: [row] });
    const body = await readJson(
      await handleCheckPaymentRequest(jsonRequest({ paymentId: "same-id" }), client)
    );

    assertPendingWithoutPurchaseData(body, "same-id");
  }
});

test("applies exact id, website source, and provider filters together", async () => {
  const { client, calls } = createMockSupabase({
    fixtures: [
      paidFixture({ id_payment: "other-id", tg_link_token: "other-token" }),
      paidFixture({ source_channel: "bot", tg_link_token: "bot-token" }),
      paidFixture({ payment_provider: "yookassa", tg_link_token: "yookassa-token" }),
      paidFixture({ payment_provider: null, tg_link_token: "null-provider-token" }),
    ],
  });

  const body = await readJson(
    await handleCheckPaymentRequest(jsonRequest({ paymentId: "same-id" }), client)
  );

  assertExpectedQuery(calls, "same-id");
  assert.equal(body.paid, true);
  assert.equal(body.tgToken, "null-provider-token");
});

test("returns safe error for DB lookup failure", async () => {
  const { client } = createMockSupabase({
    fixtures: [],
    error: { code: "PGRST000", message: "raw database detail" },
  });

  const response = await handleCheckPaymentRequest(jsonRequest({ paymentId: "123" }), client);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const body = await readJson(response);
  assert.deepEqual(body, { ok: false, status: "error", reason: "supabase_lookup_failed" });
});

test("returns safe error when Supabase config is missing", async () => {
  const response = await handleCheckPaymentRequest(jsonRequest({ paymentId: "123" }), null);
  assert.equal(response.status, 500);

  const body = await readJson(response);
  assert.deepEqual(body, { ok: false, status: "error", reason: "supabase_config_missing" });
});

test("rejects empty paymentId", async () => {
  const { client } = createMockSupabase({ fixtures: [] });
  const response = await handleCheckPaymentRequest(jsonRequest({ paymentId: "   " }), client);
  assert.equal(response.status, 400);

  const body = await readJson(response);
  assert.deepEqual(body, { error: "paymentId required" });
});
