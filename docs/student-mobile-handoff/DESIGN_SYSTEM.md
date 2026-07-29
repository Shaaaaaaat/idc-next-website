# Design System Inventory

This inventory summarizes recurring trainer web visual values and converts them into semantic mobile-friendly tokens. It is based on `tailwind.config.js`, `src/app/globals.css`, `src/components/lk/LkShell.tsx`, `src/components/lk/LkShellNav.tsx`, `src/components/lk/LkStudentCalendar.tsx`, `src/components/lk/LkProgramEditor.tsx`, `src/components/lk/LkExerciseEditorModal.tsx`, and `src/components/lk/workout-editor/ClipboardNotification.tsx`.

Do not copy Tailwind classes into React Native. Use this as token guidance.

## Brand Palette

Established in `tailwind.config.js`:

- Primary: `#D81696`.
- Secondary blue: `#1A3BFF`.
- Dark: `#050816`.
- Light: `#F5F6FF`.
- Accent: `#7CFFB2`.
- Muted: `#9CA3AF`.

Recommended mobile canonical tokens:

- `color.primary`: `#D81696`.
- `color.primaryPressed`: `#C21486` recommendation based on current `bg-brand-primary/90` usage.
- `color.secondary`: `#1A3BFF`.
- `color.accent`: `#7CFFB2`.
- `color.background`: `#F5F6FB` from `LkShell`.
- `color.backgroundDark`: `#050816`.

## Surfaces

Recurring web surfaces:

- App background: `#f5f6fb` in `LkShell`.
- Main cards: white with `border-slate-200` and `shadow-sm`.
- Muted tiles: `slate-50`, `slate-100`.
- Dark guest/auth surfaces: `brand.dark`, `white/5`, `white/10` borders.
- Floating overlays: `white/95` with backdrop blur and stronger shadow.

Recommended tokens:

- `color.surface`: `#FFFFFF`.
- `color.surfaceMuted`: `#F8FAFC`.
- `color.surfaceSubtle`: `#F1F5F9`.
- `color.border`: `#E2E8F0`.
- `color.borderStrong`: `#CBD5E1`.

## Text

Recurring values:

- Primary text: `slate-950`.
- Strong secondary: `slate-700`.
- Secondary: `slate-600`.
- Muted: `slate-500`.
- Disabled: `slate-400`.
- Dark auth text: white and `brand-muted`.

Recommended tokens:

- `color.textPrimary`: `#020617`.
- `color.textSecondary`: `#475569`.
- `color.textMuted`: `#64748B`.
- `color.textDisabled`: `#94A3B8`.

## Status Colors

Success:

- Surfaces: `emerald-50`.
- Borders: `emerald-200`.
- Text: `emerald-700` / `emerald-800`.
- Solid: `emerald-500`.

Warning:

- Login warning uses `amber-500/10`, `amber-400/30`, `amber-200`.
- Recommended mobile warning: `#D97706` with `#FFFBEB`.

Danger:

- Error banners: `red-50`, `red-200`, `red-700`.
- Destructive controls: `red-50`, `red-200`, `red-600`.
- Recommended mobile danger: `#DC2626` with `#FEF2F2`.

## Spacing

Recurring web spacing:

- Small gaps: `gap-1.5`, `gap-2`.
- Form/card padding: `px-3 py-2`, `p-3`, `p-4`.
- Large panel padding: `sm:p-6`.
- Page padding: `px-4 py-4`.

Recommended mobile spacing:

- `xs`: 4.
- `sm`: 8.
- `md`: 12.
- `lg`: 16.
- `xl`: 24.
- `xxl`: 32.

## Radii

Established and recurring:

- Small controls: `rounded-lg` / 8px.
- Inputs/buttons/cards: `rounded-xl` / 12px.
- Banners/modals: `rounded-2xl` / 16px.
- Workout cards: `rounded-3xl` / 28px from Tailwind extension.
- Pills: `rounded-full`.

Recommended tokens:

- `radii.sm`: 8.
- `radii.md`: 12.
- `radii.lg`: 16.
- `radii.xl`: 24.
- `radii.xxl`: 28.
- `radii.pill`: 999.

## Shadows

Recurring:

- `shadow-sm` for cards.
- `shadow-xl` / `shadow-2xl` for modals and overlays.
- `shadow-soft`: `0 18px 50px rgba(26,59,255,0.25)` in Tailwind config.

Mobile recommendation:

- Use subtle card elevation for regular surfaces.
- Use stronger elevation only for floating toasts, bottom sheets, and action bars.
- Keep shadows less saturated than `shadow-soft`; the blue shadow is more marketing/landing-page than LK product UI.

## Typography

Fonts:

- `src/app/layout.tsx` uses `Geist` and `Geist_Mono` through `next/font/google`.
- The layout applies font variables, not a portable font asset. Treat current font behavior as web-specific and verify actual rendered font before matching it.
- Mobile cannot reuse `next/font`; choose a native/system font or bundle a licensed font intentionally.

Recurring sizes:

- Caption/eyebrow: 11-12px, uppercase, letter spacing `0.18em` to `0.2em`.
- Body: 14px.
- Inputs and card titles: 14-16px.
- Section headings: 18-20px.
- Screen titles: 20-24px in LK; 30-48px on marketing pages.

Mobile recommendation:

- Body: 14-16px depending on screen density and accessibility settings.
- Card title: 16px, semibold.
- Screen title: 24px, semibold.
- Respect dynamic type; avoid fixed clipped text for workout instructions.

## Buttons

Recurring variants:

- Primary pill: `bg-brand-primary`, white text, semibold, hover `brand-primary/90`.
- Secondary outline: white or transparent background, `border-slate-200`, `text-slate-600`.
- Soft success: `emerald-50`, `emerald-200`, `emerald-700`.
- Danger: `red-50`, `red-200`, `red-600`.
- Disabled: opacity 60-70%, `cursor-not-allowed`, muted colors.

Mobile mapping:

- Primary CTA: full-width or prominent pill with 44px minimum height.
- Secondary: outline or ghost.
- Danger: separate from primary actions and always confirmed.
- Icon-only buttons: minimum 44x44 touch area even if visual icon is 20-24px.

## Inputs and Textareas

Recurring variants:

- Light input: white background, `border-slate-200`, rounded 12-16px, padding 12-16px horizontal, focus border `brand-primary`.
- Dark auth input: `bg-black/20`, `border-white/15`, white text.
- Inline metric inputs: borderless inside metric containers in `LkProgramEditor`.
- Textareas: `min-h-24`, rounded 16px.

Mobile mapping:

- Use platform text inputs with stable height and clear focus state.
- Avoid inline dense metric editing for student MVP unless actually needed.
- Handle keyboard avoidance explicitly.

## Cards

Recurring cards:

- Shell panel: white, `rounded-2xl/3xl`, `border-slate-200`, `shadow-sm`.
- Info card: `rounded-xl`, white, `px-4 py-3`, label caption + value.
- Workout card: `rounded-3xl`, white, `p-3`, compact exercise rows, selected emerald ring.
- Program card: large rounded white card, badges and exercise count.

Mobile mapping:

- Use one-column card stacks.
- Keep workout content readable; do not copy desktop grid density.
- Use selected/completed states with semantic success tokens.

## Notifications

Current patterns:

- Inline success/error banners in forms and calendar.
- Fixed clipboard toast in `ClipboardNotification`: top-center, `white/95`, `emerald-200`, `emerald-800`, `shadow-xl`, `z-[45]`.
- Bottom fixed selection bar in `WorkoutSelectionBar`.

Mobile mapping:

- Use top safe-area toast or bottom snackbar depending on screen.
- Avoid overlaying primary workout controls.
- Use native haptics sparingly for success/destructive events.

## Loading, Empty, Disabled, Selected, Focus

Loading:

- Button labels change, e.g. "Сохраняем...", "Загружаем 50%".
- Upload progress bar uses primary fill over `slate-100`.
- Calendar pending banner says "Обновляю календарь...".

Empty:

- "Ученики не найдены.", "Без упражнений.", "Ничего не найдено".
- Empty workout/exercise states are textual, not illustration-based.

Disabled:

- Opacity, muted text, disabled cursor.
- Pending pasted workouts are read-only and mutation-disabled in `LkStudentCalendar`.

Selected:

- Emerald border/ring/surface for selected workout cards.
- Active nav uses primary or dark surface.

Focus:

- Web uses focus ring `brand-primary/20`, focus border primary, and focus-within borders.
- Mobile needs native accessibility focus and visible pressed states.

## Icons

Current app mainly uses text glyphs and inline SVG:

- Card controls use glyphs such as `☰`, `✓`, `⧉`, `×`, arrows, and a small inline paste SVG.
- No icon library dependency is present in `package.json`.

Mobile recommendation:

- Use a consistent Expo-compatible icon library after product approval.
- Keep visual icon size 20-24px and touch target 44px.
- Avoid emoji-style icons for core product controls.

## Breakpoints

Web breakpoints are Tailwind defaults:

- `sm`: 640px.
- `md`: 768px.
- `lg`: 1024px.

Mobile should not reproduce breakpoints directly. Use phone/tablet adaptive layout primitives and safe areas.

## Inconsistencies To Resolve

- Background differs between Tailwind `brand.light` (`#F5F6FF`) and LK shell background (`#F5F6FB`). Recommendation: use `#F5F6FB` for product app background.
- Marketing pages use dark brand and large hero typography; LK product UI uses light surfaces and compact typography. Student app should follow product UI, not marketing pages.
- Icon language is inconsistent: glyphs, inline SVG, text buttons. Mobile should standardize.
- No dark-mode product palette is established beyond guest/auth dark screens.
- Font choice for mobile is undecided because current font loading is Next-specific.
