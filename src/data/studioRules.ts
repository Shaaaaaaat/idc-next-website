// src/data/studioRules.ts
// Base weekly schedules per studio in local code for instant availability.
// Weekday: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type StudioId = "msk_youcan" | "msk_elfit" | "spb_spirit" | "spb_hkc";

// Each weekday -> array of "HH:mm" local times (MSK)
export const studioRules: Record<StudioId, Partial<Record<Weekday, string[]>>> = {
  msk_youcan: {
    2: ["18:40", "20:00"], // Tue
    4: ["18:40", "20:00"], // Thu
    6: ["12:00"], // Sat
  },
  msk_elfit: {
    1: ["20:00"], // Mon
    3: ["20:00"], // Wed
    5: ["20:00"], // Fri
  },
  spb_spirit: {
    2: ["21:00"], // Tue
    4: ["21:00"], // Thu
    6: ["14:00"], // Sat
  },
  spb_hkc: {
    1: ["20:30"], // Mon
    3: ["20:30"], // Wed
    6: ["14:00"], // Sat
  },
};

// For “working weekend” overrides per studio:
// msk_youcan, spb_spirit -> use Tuesday (2)
// msk_elfit, spb_hkc     -> use Monday (1)
export const workingWeekendWeekdayByStudio: Record<StudioId, Weekday> = {
  msk_youcan: 2,
  spb_spirit: 2,
  msk_elfit: 1,
  spb_hkc: 1,
};

