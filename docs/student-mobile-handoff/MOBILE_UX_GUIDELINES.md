# Mobile UX Guidelines

The student mobile app should feel like the same product, but it must not copy desktop layouts or web-only interactions. Use trainer web screens as visual references and translate them into native mobile patterns.

## Global Mobile Principles

- Minimum touch target: 44x44px.
- Respect iOS and Android safe areas.
- Prefer one primary action per screen.
- Keep workout instructions readable and avoid truncating meaningful reps/notes.
- Use native keyboard avoidance for forms and notes.
- Prefer full-screen flows for complex editing or workout execution.
- Use bottom sheets for short choices, confirmations, filters, and secondary actions.
- Use pull-to-refresh for agenda/history screens after APIs exist.
- Make loading states explicit: skeleton cards for workouts, progress indicator for media.
- Keep destructive actions behind confirmation.
- Use haptic feedback only for high-confidence moments: workout completion, set completion, destructive confirmation.
- Support dynamic font sizes and screen-reader labels from the start.
- Plan dark mode, but do not ship it without approved tokens.

## Pattern Translation

### Trainer Desktop Modal -> Student Full-Screen or Bottom Sheet

Reference:

- `src/components/lk/LkExerciseEditorModal.tsx`.
- Program import modal in `src/components/lk/LkStudentCalendar.tsx`.

Mobile pattern:

- Use full-screen screens for workout details, active workout, and exercise/video details.
- Use bottom sheets for small selectors such as exercise alternatives, date selection, or quick actions.
- Avoid desktop modal widths, portals, and backdrop-click expectations.

### Trainer Drag-and-Drop -> Explicit Mobile Controls

Reference:

- `@dnd-kit` usage in `src/components/lk/LkStudentCalendar.tsx` and `src/components/lk/LkProgramEditor.tsx`.

Mobile pattern:

- Student app should not need trainer-style DnD in MVP.
- If reordering ever exists, use explicit reorder handles or edit mode, not desktop drag gestures.

### Trainer Calendar Grid -> Student Agenda/List

Reference:

- Seven-column calendar in `src/components/lk/LkStudentCalendar.tsx`.

Mobile pattern:

- Today screen: current workout first, then upcoming workouts.
- Calendar/history: agenda list grouped by date, optionally with a compact horizontal date strip.
- Avoid seven-column desktop calendar as the primary mobile layout.

### Workout Card -> Mobile Workout Summary Card

Reference:

- `WorkoutCard` in `src/components/lk/LkStudentCalendar.tsx`.
- Program workout cards in `src/components/lk/LkProgramEditor.tsx`.

Mobile pattern:

- Rounded white surface, subtle border, compact title, exercise count, and first few exercise titles if useful.
- Do not hide important instructions behind hover-only controls.
- Completion state should be visible without opening the card.

### Exercise Row -> Mobile Exercise Step

Reference:

- Exercise rows and group blocks in `src/components/lk/LkProgramEditor.tsx`.
- Calendar preview rows in `src/components/lk/LkStudentCalendar.tsx`.

Mobile pattern:

- Use A/B/C markers for continuity.
- Show exercise title, video affordance, raw metrics, and completion checkbox/toggle.
- Group/combo exercises should be visually nested or connected, not cramped.

### Metric Summary -> Readable Mobile Prescription

Reference:

- Program metric summary/editing in `src/components/lk/LkProgramEditor.tsx`.

Mobile pattern:

- Display raw reps text exactly.
- Put primary prescription on the first line where possible.
- Keep rest as secondary metadata or timer affordance.
- Do not require trainer edit controls in the student app.

### Note Block -> Expandable Note

Reference:

- Notes in `src/components/lk/LkProgramEditor.tsx` and exercise editor.

Mobile pattern:

- Notes should be readable with preserved line breaks.
- Use expand/collapse only for long notes.
- If student feedback is added later, separate coach notes from student notes.

### Alert/Toast -> Native-Safe Feedback

Reference:

- `src/components/lk/workout-editor/ClipboardNotification.tsx`.
- Inline banners across LK screens.

Mobile pattern:

- Use safe-area top toast or bottom snackbar.
- Success messages should be short and non-blocking.
- Error messages should include retry when recovery is possible.
- Avoid simultaneous duplicate banners.

### Selection Bar -> Mobile Action Sheet or Bottom Bar

Reference:

- `src/components/lk/WorkoutSelectionBar.tsx`.

Mobile pattern:

- Student app likely does not need multi-select in MVP.
- If bulk actions appear later, use bottom action bar with large touch targets.

## Screen-Level Guidance

### Today

- Primary content: today's workout or clear empty state.
- Secondary content: upcoming workout date and coach note.
- Pull-to-refresh after student workout API exists.
- Offline: show cached last-known data with stale indicator.

### Workout Details

- Use full-screen view.
- Top section: title, date, coach note.
- Body: exercise list with videos and metrics.
- Bottom CTA: "Начать тренировку" or "Продолжить".

### Active Workout

- Keep current exercise prominent.
- Support set completion, exercise completion, rest timer, and video preview.
- Prevent accidental destructive reset.
- Consider screen awake behavior only after product approval.

### Exercise Video

- Use native video player or WebView only if Cloudflare iframe URLs require it.
- Document playback constraints after API/video policy review.
- Provide fallback copy when video fails.

### Profile

- Show email, balance, access-until date.
- Logout must clear secure mobile token storage.
- Avoid exposing internal role/coach fields.

## Accessibility

- Every icon-only action must have a screen-reader label.
- Workout cards should have clear accessible names and states.
- Support dynamic font sizes; avoid fixed-height clipping.
- Color must not be the only signal for success/error/completion.
- Rest timer must be accessible to screen readers and not rely only on vibration.

## Offline and Sync

Current trainer web relies on server refresh and does not implement offline queueing. For mobile:

- MVP can be online-first.
- Cache read-only workout data.
- Do not invent offline completion sync until product decides conflict rules.
- If optimistic IDs are used, follow the current invariant: `optimistic-*` IDs are temporary UI identifiers and must never be sent to persisted UUID endpoints.
