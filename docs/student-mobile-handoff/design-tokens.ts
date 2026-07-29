export const colors = {
  background: "#F5F6FB",
  backgroundDark: "#050816",
  surface: "#FFFFFF",
  surfaceMuted: "#F8FAFC",
  surfaceSubtle: "#F1F5F9",
  textPrimary: "#020617",
  textSecondary: "#475569",
  textMuted: "#64748B",
  textDisabled: "#94A3B8",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  primary: "#D81696",
  primaryPressed: "#C21486",
  secondary: "#1A3BFF",
  accent: "#7CFFB2",
  success: "#059669",
  successSurface: "#ECFDF5",
  warning: "#D97706",
  warningSurface: "#FFFBEB",
  danger: "#DC2626",
  dangerSurface: "#FEF2F2",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 28,
  pill: 999,
} as const;

export const typography = {
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400",
  },
  bodyStrong: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  title: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
  },
  screenTitle: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600",
  },
} as const;

export const shadows = {
  card: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  floating: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.15,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

export const iconSizes = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 32,
} as const;

export const layout = {
  touchTargetMin: 44,
  screenHorizontalPadding: 16,
  cardGap: 12,
  bottomBarHeight: 64,
} as const;
