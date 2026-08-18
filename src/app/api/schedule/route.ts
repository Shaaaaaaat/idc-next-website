// src/app/api/schedule/route.ts
import { NextRequest, NextResponse } from "next/server";
import Holidays from "date-holidays";
import {
  studioRules,
  workingWeekendWeekdayByStudio,
  type StudioId,
  type Weekday,
} from "@/data/studioRules";
import {
  getProductionCalendarOverride,
  getStudioDateTimesOverride,
} from "@/data/productionCalendar";
import {
  getActiveScheduleExceptionsForRange,
  type ScheduleExceptionRow,
} from "@/lib/supabase/scheduleExceptions";

type Exception = ScheduleExceptionRow;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EXTEND_DAYS = 7;
const MSK_OFFSET_MIN = 180;

function toTwo(n: number) {
  return String(n).padStart(2, "0");
}

function buildSlotId(studioId: string, y: number, m: number, d: number, hh: number, mm: number) {
  return `${studioId}-${y}-${toTwo(m)}-${toTwo(d)}-${toTwo(hh)}${toTwo(mm)}`;
}

function dateKeyFromUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${toTwo(date.getUTCMonth() + 1)}-${toTwo(date.getUTCDate())}`;
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

    // Type guard for known studio ids
    function isStudioId(x: string): x is StudioId {
      return x === "msk_youcan" || x === "msk_elfit" || x === "spb_spirit" || x === "spb_hkc";
    }
    // Validate studio id for local rules
    if (!isStudioId(studioId)) {
      return NextResponse.json(
        { slots: [], notices: [`Нет расписания для студии ${studioId}`] },
        { status: 200 }
      );
    }
    const studioKey: StudioId = studioId;

    // compute base "today" in Moscow time (+03:00) and iterate from there
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
    const rangeStart = dateKeyFromUtcDate(new Date(startOfTodayMskUtc));
    const rangeEnd = dateKeyFromUtcDate(
      new Date(startOfTodayMskUtc + (days + MAX_EXTEND_DAYS) * DAY_MS)
    );

    const exceptionsResult = await getActiveScheduleExceptionsForRange({
      rangeStart,
      rangeEnd,
    });
    if (!exceptionsResult.ok) {
      console.warn("[schedule] schedule_exceptions query failed", exceptionsResult);
      return NextResponse.json(
        {
          slots: [],
          notices: ["Расписание временно недоступно. Попробуйте позже."],
        },
        { status: 503 }
      );
    }

    const exceptions: Exception[] = exceptionsResult.exceptions.filter((e) => {
      const exceptionStudio = String(e.studio_id || "").trim();
      const exceptionProduct = String(e.product_scope || "").trim().toLowerCase();
      return (
        (!exceptionStudio || exceptionStudio === studioKey) &&
        (!exceptionProduct || exceptionProduct === product)
      );
    });

    // Notices list (messages from exceptions)
    const notices: string[] = [];

    const resultSlots: { id: string; studioId: string; startAtLocal: string; startAtISO: string }[] = [];

    const hd = new Holidays("RU");
    // Planned weekdays for this studio (0..6)
    const plannedWeekdays = Object.keys(studioRules[studioKey] || {})
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n)) as Weekday[];
    const coveredWeekdays = new Set<number>();
    for (let di = 0; di < days; di++) {
      const dayMskUtc = new Date(startOfTodayMskUtc + di * DAY_MS); // UTC date representing MSK midnight
      const originalWeekday: Weekday = dayMskUtc.getUTCDay() as Weekday; // 0..6 (0=Sun)
      let weekdayMsk: Weekday = originalWeekday; // may adjust below

      // YYYY-MM-DD key in MSK
      const y = dayMskUtc.getUTCFullYear();
      const m = dayMskUtc.getUTCMonth() + 1;
      const day = dayMskUtc.getUTCDate();
      const dateKey = `${y}-${toTwo(m)}-${toTwo(day)}`;
      const dayHasBlock = exceptions.some((e) => {
        if (!e.start_date || !e.end_date) return false;
        const start = e.start_date!;
        const end = e.end_date;
        return dateKey >= start && dateKey <= end;
      });
      if (dayHasBlock) {
        const msgs = exceptions
          .filter((e) => e.start_date && e.end_date && dateKey >= e.start_date && dateKey <= e.end_date)
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
      const override = getProductionCalendarOverride(dateKey);
      const isHoliday = override === "non_working" || !!hd.isHoliday(dateNoonUtc);
      const isWeekend = weekdayMsk === 0 || weekdayMsk === 6;
      let isWorkingWeekend = override === "working";
      // @ts-ignore optional API across versions
      if (!isWorkingWeekend && typeof (hd as any).isBusinessDay === "function" && isWeekend) {
        // Business day on weekend (official working Sat/Sun)
        // @ts-ignore
        isWorkingWeekend = (hd as any).isBusinessDay(dateNoonUtc) === true;
      }
      const isWeekdayHoliday = !isWeekend && isHoliday;
      if (isWeekdayHoliday) {
        // weekday holiday → use Saturday template only if studio normally trains on this weekday
        const hasOverride = !!getStudioDateTimesOverride(studioKey, dateKey);
        const trainsOnThisWeekday = !!(studioRules[studioKey]?.[originalWeekday]?.length);
        if (!hasOverride && !trainsOnThisWeekday) continue;
        if (!hasOverride && trainsOnThisWeekday) weekdayMsk = 6 as Weekday;
      } else if (isWeekend && isWorkingWeekend) {
        // working weekend → map to studio-specific weekday
        const mapped = workingWeekendWeekdayByStudio[studioKey];
        weekdayMsk = mapped;
      }

      const times = resolveHolidayTimes(studioKey, dateKey, weekdayMsk, isWeekdayHoliday);
      if (!times.length) continue;

      let producedForThisDate = false;
      for (const t of times) {
        const [hhStr = "00", mmStr = "00"] = String(t || "00:00").split(":");
        const hh = parseInt(hhStr, 10);
        const mm = parseInt(mmStr, 10);
        const id = buildSlotId(studioId, y, m, day, hh, mm);
        const localIso = `${y}-${toTwo(m)}-${toTwo(day)}T${toTwo(hh)}:${toTwo(mm)}:00+03:00`;
        // derive ISO UTC for reference
        const iso = new Date(localIso).toISOString();
        // Filter out same-day slots starting in < 1 hour from now (MSK)
        if (di === 0) {
          const slotUtc = new Date(localIso); // Date parses +03:00 and stores UTC internally
          const diffMs = slotUtc.getTime() - nowUtc.getTime();
          const oneHourMs = 1 * 60 * 60 * 1000;
          if (diffMs < oneHourMs) continue;
        }
        resultSlots.push({
          id,
          studioId: studioId,
          startAtLocal: localIso,
          startAtISO: iso,
        });
        producedForThisDate = true;
      }
      if (producedForThisDate) coveredWeekdays.add(originalWeekday);
    }

    // If some planned weekdays were not covered in the base window, try to add the next such day
    if (plannedWeekdays.length > 0) {
      const windowEndUtcMs = startOfTodayMskUtc + days * DAY_MS;
      for (const w of plannedWeekdays) {
        if (coveredWeekdays.has(w)) continue;
        // Find first date within (days, days+7] that matches weekday w
        for (let extra = 0; extra <= MAX_EXTEND_DAYS; extra++) {
          const candUtc = new Date(windowEndUtcMs + extra * DAY_MS);
          if (candUtc.getUTCDay() !== w) continue;
          const y = candUtc.getUTCFullYear();
          const m = candUtc.getUTCMonth() + 1;
          const day = candUtc.getUTCDate();
          const dateKey = `${y}-${toTwo(m)}-${toTwo(day)}`;
          // Skip if blocked by exceptions
          const isBlocked = exceptions.some((e) => {
            if (!e.start_date || !e.end_date) return false;
            const start = e.start_date!;
            const end = e.end_date;
            return dateKey >= start && dateKey <= end;
          });
          if (isBlocked) continue;
          // Apply holiday/working-weekend logic
          let weekdayMsk: Weekday = candUtc.getUTCDay() as Weekday;
          const dateNoonUtc = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
          const override = getProductionCalendarOverride(dateKey);
          const isHoliday = override === "non_working" || !!hd.isHoliday(dateNoonUtc);
          const isWeekend = weekdayMsk === 0 || weekdayMsk === 6;
          let isWorkingWeekend = override === "working";
          // @ts-ignore
          if (!isWorkingWeekend && typeof (hd as any).isBusinessDay === "function" && isWeekend) {
            // @ts-ignore
            isWorkingWeekend = (hd as any).isBusinessDay(dateNoonUtc) === true;
          }
          const isWeekdayHoliday = !isWeekend && isHoliday;
          if (isWeekdayHoliday) {
            const hasOverride = !!getStudioDateTimesOverride(studioKey, dateKey);
            const trainsOnThisWeekday = !!(studioRules[studioKey]?.[w]?.length);
            if (!hasOverride && !trainsOnThisWeekday) continue;
            if (!hasOverride && trainsOnThisWeekday) weekdayMsk = 6 as Weekday;
          } else if (isWeekend && isWorkingWeekend) {
            const mapped = workingWeekendWeekdayByStudio[studioKey];
            weekdayMsk = mapped;
          }
          const times = resolveHolidayTimes(studioKey, dateKey, weekdayMsk, isWeekdayHoliday);
          if (!times.length) continue;
          // Push all times for this candidate date (no 3h filter since it's not "today")
          for (const t of times) {
            const [hhStr = "00", mmStr = "00"] = String(t || "00:00").split(":");
            const hh = parseInt(hhStr, 10);
            const mm = parseInt(mmStr, 10);
            const id = buildSlotId(studioId, y, m, day, hh, mm);
            const localIso = `${y}-${toTwo(m)}-${toTwo(day)}T${toTwo(hh)}:${toTwo(mm)}:00+03:00`;
            const iso = new Date(localIso).toISOString();
            resultSlots.push({
              id,
              studioId: studioId,
              startAtLocal: localIso,
              startAtISO: iso,
            });
          }
          break; // added one date for this weekday
        }
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

function resolveHolidayTimes(
  studioKey: StudioId,
  dateKey: string,
  weekdayMsk: Weekday,
  isWeekdayHoliday: boolean
): string[] {
  const dateOverride = getStudioDateTimesOverride(studioKey, dateKey);
  if (dateOverride) return dateOverride;

  const byWeekday = studioRules[studioKey]?.[weekdayMsk] ?? [];
  if (byWeekday.length) return byWeekday;

  // Base rule: if a weekday turned into a non-working day and there is no weekend
  // template for the studio, provide a default daytime slot.
  if (isWeekdayHoliday) return ["12:00"];

  return [];
}
