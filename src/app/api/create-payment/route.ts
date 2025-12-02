// src/app/api/create-payment/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

function generatePaymentLink(paymentId: number | string, sum: number, email: string) {
  const shopId = process.env.ROBO_ID;      // MerchantLogin
  const secretKey1 = process.env.ROBO_SECRET1; // Secret Key 1

  if (!shopId || !secretKey1) {
    throw new Error("ROBO_ID или ROBO_SECRET1 не заданы в .env");
  }

  // Робокасса ожидает строку с точкой как разделителем
  const sumString = sum.toString();

  const signature = crypto
    .createHash("md5")
    .update(`${shopId}:${sumString}:${paymentId}:${secretKey1}`)
    .digest("hex");

  const url =
    `https://auth.robokassa.ru/Merchant/Index.aspx` +
    `?MerchantLogin=${shopId}` +
    `&OutSum=${encodeURIComponent(sumString)}` +
    `&InvId=${encodeURIComponent(String(paymentId))}` +
    `&SignatureValue=${signature}` +
    `&Email=${encodeURIComponent(email)}` +
    `&IsTest=0`;

  return url;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      amount,
      currency,
      email,
      fullName,
      courseName,
      tariffId,
      tariffLabel,
    } = body as {
      amount: number;
      currency: "RUB" | "EUR";
      email: string;
      fullName: string;
      courseName: string;
      tariffId: string;
      tariffLabel: string;
    };

    if (!amount || !email || !fullName || !tariffId) {
      return NextResponse.json(
        { error: "Не хватает данных для оплаты" },
        { status: 400 }
      );
    }

    // paymentId — можно заменить на id из базы, если будешь сохранять заказы
    const paymentId = Date.now();

    const paymentUrl = generatePaymentLink(paymentId, amount, email);

    // здесь потом можно сохранить заказ в БД (paymentId, fullName, email, courseName, tariffId, tariffLabel, currency, amount)

    return NextResponse.json({ paymentUrl });
  } catch (error) {
    console.error("Ошибка в create-payment:", error);
    return NextResponse.json(
      { error: "Ошибка на сервере при создании оплаты" },
      { status: 500 }
    );
  }
}
