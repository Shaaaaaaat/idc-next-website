// src/app/api/schedule/route.ts
import { NextRequest, NextResponse } from "next/server";
import Holidays from "date-holidays";
import { studioRules, workingWeekendWeekdayByStudio } from "@/data/studioRules";

type Rule = {
  id: string;
  studio_id?: string;
  weekday?: number; // 0..6 (0 = Sunday)
  start_time_local?: string; // "HH:mm"
  active?: boolean;
  product_scope?: string;
};

type Exception = {
  id: string;
  type?: string; // "trainer_vacation" | "studio_closed" | ...
  studio_id?: string;
  product_scope?: string; // e.g. 'trial'
  start_date?: string; // "YYYY-MM-DD"
  end_date?: string; // "YYYY-MM-DD"
  slot_id?: string; // optional, if exception targets a specific slot
  message?: string;
  status?: string; // "active" | "archived"
};

const AIRTABLE_API = "https://api.airtable.com/v0";
const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const EXCEPTIONS_TABLE_ID = process.env.AIRTABLE_EXCEPTIONS_TABLE_ID!;

if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) {
  console.warn(
    "[schedule] Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID in environment"
  );
}

function toTwo(n: number) {
  return String(n).padStart(2, "0");
}

function buildSlotId(studioId: string, y: number, m: number, d: number, hh: number, mm: number) {
  return `${studioId}-${y}-${toTwo(m)}-${toTwo(d)}-${toTwo(hh)}${toTwo(mm)}`;
}

function* iterateDays(startLocal: Date, days: number) {
  const cur = new Date(startLocal.getTime());
  for (let i = 0; i < days; i++) {
    yield new Date(cur.getTime());
    cur.setDate(cur.getDate() + 1);
  }
}

async function fetchAirtableTable(tableId: string, revalidateSec = 60) {
  const url = `${AIRTABLE_API}/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(
    tableId
  )}?pageSize=100`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
    next: { revalidate: revalidateSec },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Airtable fetch failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  return (data.records as any[]).map((r) => ({ id: r.id, ...(r.fields || {}) }));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const studioId = searchParams.get("studioId") || "";
    const product = (searchParams.get("product") || "trial").toLowerCase();
    const days = Math.max(1, Math.min(14, parseInt(searchParams.get("days") || "7", 10)));

    if (!studioId) {
      return NextResponse.json({ error: "studioId is required" }, { status: 400 });
    }
    if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) {
      return NextResponse.json(
        { error: "Server is missing Airtable configuration (env vars)" },
        { status: 500 }
      );
    }

    // Validate studio id for local rules
    if (!studioRules[studioId as any]) {
      return NextResponse.json({ slots: [], notices: [`Нет расписания для студии ${studioId}`] }, { status: 200 });
    }

    // Load exceptions (optional)
    let exceptions: Exception[] = [];
    if (!EXCEPTIONS_TABLEID_MISSING_GUARD()) {
      try {
        const allEx = (await fetchAirtableTable(EXCEPTIONS_TABLE_ID, 60)) as any as Exception[];
        exceptions = allEx.filter(
          (e) =>
            (e.status || "active") !== "archived" &&
            (!e.studio_id || e.studio_id === studioId) &&
            (!e.product_scope || String(e.product_scope).toLowerCase() === product)
        );
      } catch (e) {
        console.warn("[schedule] fetching exceptions failed, continuing without exceptions", e);
      }
    }

    // Notices list (messages from exceptions)
    const notices: string[] = [];

    const resultSlots: { id: string; studioId: string; startAtLocal: string; startAtISO: string }[] = [];

    // compute base "today" in Moscow time (+03:00) and iterate from there
    const MSK_OFFSET_MIN = 180;
    const nowUtc = new Date();
    const nowMsk = new Date(nowUtc.getTime() + MSK_OFFSET_MIN * 60 * 1000);
    const startOfTodayMskUtc = Date.UTC(
      nowMsk.getUTCFullYear(),
      nowMsk.getUTCMonth(),
      nowMsk.getUTCDate(),
      0,
      0,
      0,
      0
    );

    const hd = new Holidays("RU");
    for (let di = 0; di < days; di++) {
      const dayMskUtc = new Date(startOfTodayMskUtc + di * 24 * 60 * 60 * 1000); // UTC date representing MSK midnight
      let weekdayMsk = dayMskUtc.getUTCDay(); // 0..6 (0=Sun) in MSK context

      // YYYY-MM-DD key in MSK
      const y = dayMskUtc.getUTCFullYear();
      const m = dayMskUtc.getUTCMonth() + 1;
      const day = dayMskUtc.getUTCDate();
      const dateKey = `${y}-${toTwo(m)}-${toTwo(day)}`;
      const dayHasBlock = exceptions.some((e) => {
        if (!e.start_date) return false;
        const start = e.start_date!;
        const end = e.end_date || e.start_date;
        return dateKey >= start && dateKey <= end;
      });
      if (dayHasBlock) {
        const msgs = exceptions
          .filter((e) => e.start_date && dateKey >= e.start_date! && (!e.end_date || dateKey <= e.end_date!))
          .map((e) => e.message)
          .filter(Boolean) as string[];
        if (msgs.length) {
          msgs.forEach((m) => {
            if (!notices.includes(m)) notices.push(m);
          });
        }
        continue; // skip generating slots for blocked days
      }
      // Holiday / working weekend adjustments
      const dateNoonUtc = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
      const isHoliday = !!hd.isHoliday(dateNoonUtc);
      const isWeekend = weekdayMsk === 0 || weekdayMsk === 6;
      let isWorkingWeekend = false;
      // @ts-ignore optional API across versions
      if (typeof (hd as any).isBusinessDay === "function" && isWeekend) {
        // Business day on weekend (official working Sat/Sun)
        // @ts-ignore
        isWorkingWeekend = (hd as any).isBusinessDay(dateNoonUtc) === true;
      }
      if (!isWeekend && isHoliday) {
        // weekday holiday → use Saturday template
        weekdayMsk = 6;
      } else if (isWeekend && isWorkingWeekend) {
        // working weekend → map to studio-specific weekday
        const mapped = workingWeekendWeekdayByStudio[studioId as any];
        if (typeof mapped === "number") weekdayMsk = mapped;
      }

      const times = (studioRules as any)[studioId]?.[weekdayMsk] as string[] | undefined;
      if (!times || times.length === 0) continue;

      for (const t of times) {
        const [hhStr = "00", mmStr = "00"] = String(t || "00:00").split(":");
        const hh = parseInt(hhStr, 10);
        const mm = parseInt(mmStr, 10);
        const id = buildSlotId(studioId, y, m, day, hh, mm);
        const localIso = `${y}-${toTwo(m)}-${toTwo(day)}T${toTwo(hh)}:${toTwo(mm)}:00+03:00`;
        // derive ISO UTC for reference
        const iso = new Date(localIso).toISOString();
        // Filter out same-day slots starting in < 3 hours from now (MSK)
        if (di === 0) {
          const slotUtc = new Date(localIso); // Date parses +03:00 and stores UTC internally
          const diffMs = slotUtc.getTime() - nowUtc.getTime();
          const threeHoursMs = 3 * 60 * 60 * 1000;
          if (diffMs < threeHoursMs) continue;
        }
        resultSlots.push({
          id,
          studioId: studioId,
          startAtLocal: localIso,
          startAtISO: iso,
        });
      }
    }

    // Sort by time
    resultSlots.sort((a, b) => (a.startAtISO < b.startAtISO ? -1 : a.startAtISO > b.startAtISO ? 1 : 0));

    const res = NextResponse.json({ slots: resultSlots, notices });
    res.headers.set("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
    return res;
  } catch (e: any) {
    console.error("[/api/schedule] error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}

function EXCEPTIONS_TABLEID_MISSING_GUARD() {
  if (!EXCEPTIONS_TABLE_ID) {
    console.warn("[schedule] Missing AIRTABLE_EXCEPTIONS_TABLE_ID (optional)");
    return true;
  }
  return false;
}

// Utility to add i days to a base date and keep midnight
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
