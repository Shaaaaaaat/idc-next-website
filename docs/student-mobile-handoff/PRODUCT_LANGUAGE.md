# Product Language

This document defines product vocabulary and UI semantics for the future student mobile app. It is intentionally not a technical API document. Use it to keep web, mobile, copy, design, and support language consistent.

## Purpose

Avoid multiple words meaning the same thing across the product. A trainer, a student, a designer, and an engineer should all understand the same nouns and actions.

When this document conflicts with existing code names, prefer the product language in user-facing UI and document any technical alias separately.

## Core Entity Names

| Product term | Russian UI term | Meaning | Avoid as synonym |
|---|---|---|---|
| Workout | Тренировка | A planned or completed training unit assigned to a student for a date. | Training, Session, Lesson |
| Exercise | Упражнение | A single movement/task inside a workout. | Drill, Item |
| Exercise Group | Комбо | A grouped block of exercises performed together or treated as one block. | Group, Superset, Circuit unless product explicitly changes this |
| Program | Программа | A reusable template or plan made by a coach and imported/assigned into a calendar. | Course, Plan, Template in UI |
| Student | Ученик | The client receiving workouts. | Client in user-facing UI |
| Coach | Тренер | The person creating programs/workouts and reviewing progress. | Trainer in Russian UI |
| Metrics | Параметры | Sets, reps, rest, tempo, and related prescription values. | Stats, Numbers |
| Notes | Заметки | Free-text coach guidance or exercise notes. | Comments, Description unless context differs |
| Completion | Выполнение | Student progress/completion state for workout/exercise/set. | Status unless showing technical state |
| Rest | Отдых | Time or instruction between sets/exercises. | Pause |
| Video | Видео | Exercise demonstration or instruction video. | Clip |

## Technical Aliases

Some current code and database names differ from product language:

- `client` in code means product `Student`.
- `CoachWorkout` is product `Workout`.
- `ExerciseGroup` is product `Exercise Group / Комбо`.
- `ProgramTemplate` is product `Program`.
- `coachComment` is product `Coach note` / `Заметка тренера`.

Do not expose these technical names directly in student UI.

## Workout Status Language

Use these labels consistently when status exists:

| State | Russian UI label | Meaning |
|---|---|---|
| Planned | Запланирована | Workout exists but student has not started/completed it. |
| In progress | В процессе | Student started but has not finished. |
| Completed | Выполнена | Student marked workout complete. |
| Missed | Пропущена | Student did not complete a scheduled workout, if product supports this. |
| Locked / syncing | Синхронизируется | Temporary state while authoritative server data is loading. |

Current backend completion support is incomplete. Treat status labels as product direction until student completion APIs exist.

## Metric Formatting

### Canonical Display

Use compact Russian product formatting:

- Sets and reps: `3 × 8–10`.
- Sets only: `3 подх.`
- Reps only: `8–10`
- Rest: `отдых 2 мин`
- Tempo: `темп 3-1-1`

Examples:

- `3 × 8–10`
- `4 × 5–8 • отдых 2 мин`
- `3 подх. • отдых до восстановления`

### Rules

- Preserve raw reps text exactly as written by the coach.
- Do not append `раз` or `повторений` to reps unless product explicitly changes this.
- Use `подх.` instead of trying to pluralize `подход/подхода/подходов`.
- Use multiplication sign `×`, not `x`.
- Use en dash `–` for ranges when content is authored or normalized by UI. If coach text is raw, preserve it.
- Keep rest visually secondary to the main prescription.
- If a value is missing, hide that segment or show a clear add/edit affordance in trainer tools. In student UI, avoid noisy placeholders.

### Avoid

- Mixing `sets`, `подходы`, and `подх.` in user-facing UI.
- Converting free-text reps into numbers.
- Rewriting coach-authored raw metric text.

## Date and Time Language

- Calendar date key: `YYYY-MM-DD` internally.
- User-facing short day: `ПН 27`.
- User-facing range: `13 июля — 19 июля 2026 г.`.
- Use Russian locale for month and weekday names.
- For rest timers, use `мин` and `сек` once timer parsing rules exist.

## Color Semantics

Use color by meaning, not by feature.

| Meaning | Token / color family | Use |
|---|---|---|
| Primary action / brand | Primary pink `#D81696` | Main CTA, active primary nav, important focus. |
| Secondary brand | Blue `#1A3BFF` | Reserved; currently less used in LK product UI. Do not use randomly. |
| Completed / success / selected | Emerald / green | Completed workout, success notification, selected workout state. |
| Warning / attention | Amber / orange | Expired link, stale data, sync taking too long. |
| Destructive / error | Red | Delete, archive, failed save, unrecoverable error. |
| Neutral surface | Slate / white | Cards, lists, secondary actions. |
| Disabled | Slate muted | Unavailable actions, pending/locked states. |

Rules:

- Green means success/completed/selected, not primary CTA.
- Red is for destructive or error only.
- Orange is for warnings that need attention but are not destructive.
- Blue should not compete with primary pink unless a specific secondary role is approved.
- Do not rely on color alone; pair with text, icon, or state label.

## Button Language

### Primary Button

Purpose:

- Main screen action.
- One primary action per screen or bottom action area.

Examples:

- `Начать тренировку`
- `Продолжить`
- `Сохранить`

### Secondary Button

Purpose:

- Non-destructive alternative.
- Navigation to optional detail.

Examples:

- `Позже`
- `Посмотреть видео`
- `Отмена`

### Danger Button

Purpose:

- Destructive or irreversible action.

Examples:

- `Удалить`
- `Сбросить`
- `Скрыть`

Rules:

- Danger actions require confirmation.
- Disabled buttons should explain why when the reason is not obvious.
- Loading buttons should keep the same position and show action-specific text, e.g. `Сохраняем...`.

## Notifications

### Success Notification

Use for completed user actions.

Examples:

- `Тренировка сохранена`
- `Тренировка выполнена`
- `Видео добавлено`

Rules:

- Short, temporary, non-blocking.
- Do not show duplicate success notifications for one action.

### Error Notification

Use for failed actions.

Examples:

- `Не удалось сохранить тренировку. Попробуй ещё раз.`
- `Видео недоступно. Проверь соединение.`

Rules:

- Never show raw technical errors like `TypeError: fetch failed`.
- Include retry when recovery is possible.
- Keep destructive failure messages clear and specific.

### Warning Notification

Use when action may still succeed or data is stale.

Examples:

- `Календарь обновляется дольше обычного.`
- `Тренировка была изменена в другом окне. Обнови данные.`

## Navigation Language

- Back action: `Назад`.
- Close modal/sheet: `Закрыть`.
- Cancel current action: `Отмена`.
- Save changes: `Сохранить`.
- Continue: `Продолжить`.

Mobile patterns:

- Use native back navigation for screen stack.
- Use `Закрыть` for modal or bottom sheet dismissal.
- Do not use desktop breadcrumbs in mobile.

## Modal, Bottom Sheet, and Screen Rules

| Pattern | Use for | Avoid |
|---|---|---|
| Full-screen | Workout details, active workout, exercise video/details. | Tiny confirmations. |
| Bottom sheet | Short selection, filters, quick actions, confirmations. | Long forms or long exercise lists. |
| Modal dialog | Rare on mobile; critical confirmations only. | Desktop-style large editor panels. |
| Toast/snackbar | Success/error feedback after action. | Long explanations. |

Trainer desktop modal maps to student mobile full-screen flow or bottom sheet, depending on complexity.

## Iconography

Choose one icon library before mobile implementation. Until then, keep these meanings stable:

| Meaning | Preferred icon concept | Current web reference |
|---|---|---|
| Delete | Trash | Web sometimes uses text/glyph delete controls. |
| Copy | Copy / overlapping squares | `⧉` in workout cards. |
| Complete | Check circle | `✓` in selection states, emerald success. |
| Rest | Timer / clock | Not standardized yet. |
| Note | Text note / document | Not standardized yet. |
| Video | Play circle | `▶` in exercise video actions. |
| Drag / reorder | Grip / drag handle | `☰` / `⋮⋮` in trainer tools. |
| Close | X | `×` glyph. |
| Back | Arrow left | Text/glyph back in web. |

Rules:

- Do not use emoji for core product icons.
- Icon-only controls need accessible labels.
- Visual icon size should be 20-24px; touch target at least 44px.
- Use the same icon for the same action everywhere.

## Copy Tone

Current product has mixed tone:

- Marketing often uses informal `ты`.
- Payment/legal/support flows often use formal `вы`.
- LK operational UI is concise and action-focused.

Recommendation for student mobile:

- Use `ты` for coaching/product guidance if approved.
- Use concise action labels in controls.
- Use `вы` only for legal/payment/support contexts if required.
- Avoid mixing `ты` and `вы` on the same screen.

## Student App MVP Product Language

Recommended first navigation labels:

- `Сегодня`
- `Календарь`
- `Прогресс`
- `Профиль`

If `Прогресс` has no backend support in MVP, omit it rather than showing an empty future tab.

Recommended first screen names:

- `Вход`
- `Сегодня`
- `Тренировка`
- `Упражнение`
- `Видео`
- `Профиль`

## Do Not Use In Student UI

- `Client` for student.
- `CoachWorkout`.
- `ProgramTemplate`.
- `RPC`.
- `Payload`.
- `UUID`.
- `optimistic ID`.
- Raw backend statuses unless mapped to product labels.

## Open Product Language Decisions

- Final choice between `Ученик` and `Клиент` in student-facing account/profile contexts.
- Whether a workout completion unit is workout-only, exercise-level, set-level, or all three.
- Whether `Комбо` remains the final public term for exercise groups.
- Whether rest timer uses parsed rest text or explicit timer values.
- Whether mobile uses `ты` everywhere outside legal/payment/support.
- Final icon library and exact icons.
