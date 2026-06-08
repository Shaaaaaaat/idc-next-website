"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inferProductType, mapTagToTariffLabel, trackGoal } from "@/lib/metrika";

type CheckPaymentResp =
  | {
      ok: true;
      paid?: boolean;
      status?: string;
      tgToken?: string | null;
      purchasePayload?: {
        transaction_id: string;
        tariff_label?: string;
        tag?: string;
        currency?: string;
        value?: number;
        course_name?: string;
      };
    }
  | {
      ok?: boolean;
      error?: string;
      details?: string;
    };

export default function PaymentSuccessPage() {
  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<CheckPaymentResp | null>(null);
  const [paymentId, setPaymentId] = useState<string>("");
  const tgToken = useMemo(() => String((resp as any)?.tgToken ?? "").trim(), [resp]);
  const purchaseSentRef = useRef(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const inv =
      sp.get("InvId") ||
      sp.get("invId") ||
      sp.get("invoiceId") ||
      sp.get("paymentId") ||
      "";
    setPaymentId(inv || "");

    if (!inv) {
      setLoading(false);
      setResp({ ok: false, error: "InvId отсутствует в URL" });
      return;
    }

    const run = async () => {
      try {
        setLoading(true);
        const r = await fetch("/api/check-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId: inv }),
          cache: "no-store",
        });
        const json = (await r.json().catch(() => ({}))) as any;
        setResp(json);
      } catch (e: any) {
        setResp({ ok: false, error: e?.message ?? "check-payment failed" });
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const statusLabel = (() => {
    const s = String((resp as any)?.status ?? "").toLowerCase();
    if (s === "paid") return "PAID";
    if (s === "pending") return "PENDING";
    if ((resp as any)?.paid === true) return "PAID";
    if ((resp as any)?.paid === false) return "PENDING";
    return resp ? "UNKNOWN" : "LOADING";
  })();

  const title =
    statusLabel === "PAID"
      ? "Оплата прошла успешно"
      : statusLabel === "PENDING"
      ? "Платёж обрабатывается"
      : statusLabel === "UNKNOWN"
      ? "Статус неизвестен"
      : "Статус оплаты";

  const subtitle = (() => {
    if (loading) return "Проверяем статус...";
    if (statusLabel === "PAID")
      return "Спасибо! Мы отправили вам письмо с инструкциями по дальнейшим шагам.";
    if (statusLabel === "PENDING")
      return "Ждём подтверждение от банка. Обнови страницу через минуту.";
    if (statusLabel === "UNKNOWN")
      return "Не удалось определить статус. Свяжись с нами, если есть вопросы.";
    return "";
  })();

  const botUrl = tgToken
    ? `https://t.me/IDCMAIN_bot?start=${encodeURIComponent(tgToken)}`
    : "https://t.me/IDCMAIN_bot";

  const purchasePayload = (resp as any)?.purchasePayload ?? null;
  const productName = String(purchasePayload?.course_name ?? "").trim();
  const priceValue = Number(purchasePayload?.value ?? 0) || 0;
  const tariffLabel = mapTagToTariffLabel(
    String(purchasePayload?.tag ?? purchasePayload?.tariff_label ?? "")
  );

  useEffect(() => {
    if (purchaseSentRef.current) return;
    if (statusLabel !== "PAID") return;
    if (!paymentId) return;
    purchaseSentRef.current = true;

    trackGoal("purchase", {
      product_type: inferProductType(productName),
      product_name: productName || "unknown",
      tariff_label: tariffLabel || "unknown",
      order_price: priceValue,
      payment_id: paymentId,
    });
  }, [statusLabel, paymentId, productName, tariffLabel, priceValue]);

  return (
    <main className="min-h-screen bg-brand-dark text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-sm shadow-soft px-6 py-8 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-3">
            Оплата
          </p>

          <h1 className="text-2xl sm:text-3xl font-semibold mb-4">{title} 🙌</h1>
          <p className="text-sm sm:text-base text-brand-muted">{subtitle}</p>

          {statusLabel === "PAID" && (
            <>
              <a
                href={botUrl}
                onClick={() =>
                  trackGoal("telegram_bot_open_click", {
                    payment_id: paymentId,
                    tariff_label: tariffLabel || "unknown",
                    product_name: productName || "unknown",
                    order_price: priceValue,
                    source: "CTA",
                  })
                }
                className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-2.5 text-sm font-semibold hover:bg-brand-primary/90 transition-colors"
              >
                Открыть Telegram-бот
              </a>
              <p className="mt-3 text-[13px] text-brand-muted leading-relaxed">
                В боте вы увидите баланс оставшихся тренировок, сможете заморозить
                абонемент, докупить новый тариф и быстро связаться с поддержкой.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
