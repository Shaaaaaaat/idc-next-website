"use client";

export type GoalSource = "menu" | "CTA" | "scroll";
export type ProductType = "online" | "gym";
export type DeviceType = "mobile" | "tablet" | "desktop";

function getCounterId() {
  const id = Number(process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID);
  return Number.isFinite(id) ? id : null;
}

export function detectDeviceType(): DeviceType {
  if (typeof window === "undefined") return "desktop";
  const width = window.innerWidth;
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

export function trackGoal(goal: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const ymFn = (window as any).ym;
  const counterId = getCounterId();
  if (typeof ymFn !== "function" || !counterId) return;
  ymFn(counterId, "reachGoal", goal, params ?? {});
}

export function mapTagToTariffLabel(tagRaw?: string): string | undefined {
  const tag = String(tagRaw || "").trim().toLowerCase();
  if (!tag) return undefined;
  if (tag === "gift_certificate") return "gift";
  return tag;
}

export function inferProductType(productNameRaw?: string): ProductType {
  const value = String(productNameRaw || "").toLowerCase();
  if (value.startsWith("ds_") || value.includes("gift")) return "online";
  return "gym";
}
