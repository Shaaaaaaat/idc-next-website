// src/data/productionCalendar.ts

import type { StudioId } from "@/data/studioRules";

type DayOverride = "non_working" | "working";

const overrides2026: Record<string, DayOverride> = {
  // New Year holidays and transferred days
  "2026-01-01": "non_working",
  "2026-01-02": "non_working",
  "2026-01-03": "non_working",
  "2026-01-04": "non_working",
  "2026-01-05": "non_working",
  "2026-01-06": "non_working",
  "2026-01-07": "non_working",
  "2026-01-08": "non_working",
  "2026-01-09": "non_working", // transfer from 2026-01-03

  // Public holidays and transferred weekday offs
  "2026-02-23": "non_working",
  "2026-03-09": "non_working", // transfer after 8 March
  "2026-05-01": "non_working",
  "2026-05-11": "non_working", // transfer after 9 May
  "2026-06-12": "non_working",
  "2026-11-04": "non_working",
  "2026-12-31": "non_working", // transfer from 2026-01-04
};

const productionCalendarByYear: Record<number, Record<string, DayOverride>> = {
  2026: overrides2026,
};

const studioDateTimesOverride: Partial<Record<StudioId, Record<string, string[]>>> = {
  // Special holiday training by request
  msk_elfit: {
    "2026-03-09": ["12:00"],
  },
};

export function getProductionCalendarOverride(dateKey: string): DayOverride | null {
  const year = Number(dateKey.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return productionCalendarByYear[year]?.[dateKey] ?? null;
}

export function getStudioDateTimesOverride(
  studioId: StudioId,
  dateKey: string
): string[] | null {
  return studioDateTimesOverride[studioId]?.[dateKey] ?? null;
}

