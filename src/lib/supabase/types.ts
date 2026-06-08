/** Normalized id_payment for DB (Robokassa InvId + internal payment id). */
export type IdPayment = string;

export type CreateLeadInSupabaseInput = {
  fio: string;
  phone: string;
  email?: string;
  city?: string;
  studio?: string;
  product?: string;
  source?: string;
  tgid?: string;
  created_time?: string;
  raw_payload?: unknown;
};

export type UpsertPurchaseCreatedInput = {
  source_channel: string;
  email: string;
  fi: string;
  tgid?: string | null;
  gift_recipient?: string | null;
  tg_link_token?: string | null;
  created_time?: string;
  /** Maps to DB column `sum` */
  purchaseSum: number;
  currency: string;
  lessons: number;
  price_per_lesson?: number | null;
  id_payment: number | string;
  status?: "Created";
  course_name: string;
  tag: string;
  nickname?: string | null;
  phone: string;
  locale?: string | null;
  tariff_label: string;
  studio_slug: string;
  slot_start_at?: string | null;
  format: string;
};

export type MarkPurchasePaidResult =
  | { ok: true; purchaseId: string; rpcData?: unknown }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; reason: "purchase_not_found" | "update_failed" | "rpc_failed" | "disabled"; message?: string };
