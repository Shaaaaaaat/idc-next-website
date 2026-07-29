# Reuse Matrix

Classifications:

- A: Safe to reuse as-is.
- B: Reusable after small platform-independent extraction.
- C: Web-only, use only as UX reference.
- D: Server-only, never move into the mobile client.

| Item | Current file | Classification | Why | Mobile action | Security notes |
|---|---|---:|---|---|---|
| Design token values | `tailwind.config.js`, `src/components/lk/*` | B | Values are useful, but Tailwind/className is web-only. | Use `design-tokens.ts` as draft and convert to RN theme. | No secrets. |
| Global CSS | `src/app/globals.css` | C | CSS and media queries are web-only. | Use as typography/background reference only. | No secrets. |
| LK shell layout | `src/components/lk/LkShell.tsx` | C | Next/React DOM layout and responsive grid are web-only. | Translate into mobile navigation/screen shell. | No secrets. |
| Shell nav | `src/components/lk/LkShellNav.tsx` | C | Uses Next `Link`, desktop sidebar/top nav. | Use as nav hierarchy reference. | No secrets. |
| Info cards | `src/components/lk/LkShell.tsx` | C | Component is web React, but visual pattern is reusable. | Rebuild native card component. | No secrets. |
| Button hierarchy | Multiple LK components | B | Variants are consistent enough to become tokens. | Define RN Button variants. | No secrets. |
| Exercise tag parsing | `src/components/lk/LkExerciseEditorModal.tsx`, `src/lib/supabase/exerciseLibrary.ts` | B | `parseExerciseTags` is server-only file but logic is platform-independent. | Extract/copy pure tag parser to shared mobile utils if needed. | Do not import server module. |
| Workout clipboard format | `src/components/lk/workout-editor/workoutClipboard.ts` | B | Types are plain, but hook uses React external store and clipboard is trainer feature. | Use universal workout-copy shape only if mobile needs copy later. | No server secrets; not needed for MVP. |
| Workout DTO types | `src/lib/supabase/coachWorkouts.ts` | B | Type shapes are useful, but file is server-only and includes Supabase Admin calls. | Re-declare DTOs in mobile `types/`. | Never import server file. |
| Program DTO types | `src/lib/supabase/programTemplates.ts` | B | Type shapes useful for reference; module is server-only. | Re-declare read-only DTOs only if student programs are exposed. | Never import server file. |
| ExerciseLibraryItem type | `src/lib/supabase/exerciseLibrary.ts` | B | Useful DTO, but module is server-only. | Re-declare student-safe subset in mobile. | Do not expose permission internals blindly. |
| Date helpers | `src/components/lk/LkStudentCalendar.tsx` | B | `dateKey`, `addDays`, `startOfWeek`, labels are pure but embedded in component. | Extract/copy pure date utilities with timezone review. | Beware UTC/local date behavior. |
| Metric display/raw rules | `src/components/lk/LkProgramEditor.tsx` | B | Behavior is domain-relevant but inside web component. | Document/copy pure display helpers after extraction. | Preserve raw reps text. |
| Metric payload builder | `metricPayload` in `src/components/lk/LkStudentCalendar.tsx` | B/C | Useful contract reference, but trainer/coach mutation payload is not student-safe. | Use as API reference only; create student completion payload separately. | Do not send coach-edit payload from student app. |
| Optimistic ID invariant | `src/components/lk/LkStudentCalendar.tsx` | A/B | Rule is platform-independent. | Reuse invariant: `optimistic-*` never goes to UUID endpoints. | Important data-integrity guard. |
| Error normalization for program import | `src/components/lk/LkStudentCalendar.tsx` | B | Useful distinction between abort/network/backend, but currently component-local. | Extract pure error classifier if mobile needs fetch diagnostics. | Avoid raw backend errors to users. |
| Exercise search dropdown | `src/components/lk/workout-editor/ExerciseLibrarySearchInput.tsx` | C | DOM input/dropdown behavior is web-only. | Use mobile searchable bottom sheet/list. | No secrets. |
| Workout cards | `src/components/lk/LkStudentCalendar.tsx`, `src/components/lk/LkProgramEditor.tsx` | C | Visual reference only; DnD/hover/web layout not mobile. | Rebuild native workout cards. | No secrets. |
| Exercise editor modal | `src/components/lk/LkExerciseEditorModal.tsx` | C | Web modal, file input, portal, tus browser upload. | Use only as flow reference. Student app likely read-only. | Upload endpoints coach-only. |
| Workout selection bar | `src/components/lk/WorkoutSelectionBar.tsx` | C | Web fixed bottom bar; trainer bulk actions. | Not MVP; use mobile action sheet if needed. | No secrets. |
| Clipboard notification | `src/components/lk/workout-editor/ClipboardNotification.tsx` | C | Web fixed toast. | Rebuild with native toast/snackbar. | No secrets. |
| Auth session validation | `src/lib/auth/lkSession.ts` | D | Uses Next cookies and server validation. | Build mobile token validation server-side. | Do not copy cookie code. |
| Auth service client | `src/lib/auth/lkAuth.ts` | D | Uses internal auth URL/token env vars. | Keep server-only; create mobile auth endpoints. | Contains privileged internal-token flow. |
| Access resolver | `src/lib/auth/lkAccess.ts` | D | Server-side role/client lookup. | Keep server-side; expose minimal profile DTO. | Authorization boundary. |
| Supabase server client | `src/lib/supabase/server.ts` | D | Admin/service-role area. | Never import in mobile. | High risk. |
| Coach workout persistence | `src/lib/supabase/coachWorkouts.ts` | D | Supabase Admin + coach authorization. | Server-only; expose student API DTOs. | Protect UUID ownership. |
| Program persistence | `src/lib/supabase/programTemplates.ts` | D | Supabase Admin + coach resource ACL. | Server-only. | Coach-only data mutation. |
| Exercise persistence | `src/lib/supabase/exerciseLibrary.ts` | D | Supabase Admin + permissions. | Server-only; expose read-only student subset. | Avoid exposing archive/edit permissions. |
| Cloudflare Stream helpers | `src/lib/cloudflare/stream.ts` | D | Uses Cloudflare account/token env. | Server-only video proxy/metadata endpoints. | Never expose API token. |
| Coach API routes | `src/app/api/lk/coach/**/route.ts` | C/D | Route contracts are reference; implementation is server-only and coach-only. | Create student-specific API. | Do not reuse authorization. |
| Client profile page | `src/app/lk/page.tsx` | C | Server-rendered profile UI. | Use as profile data reference. | Needs API equivalent. |
| Marketing landing pages | `src/app/page.tsx`, `src/app/pullups/PullupsLandingClient.tsx` | C | Marketing UI/copy, not product app UI. | Use tone/assets only after product review. | Remote media/licensing review. |
| Public exercise templates | `src/data/exercises.ts` | B/C | Plain data/types, but marked as templates with remote videos. | Use as seed/reference only after content review. | Remote URL rights/performance unknown. |
| Payment routes | `src/app/api/create-payment/route.ts`, `src/app/api/robokassa/result/route.ts` | D | Payment signatures, Airtable, Telegram, env secrets. | Out of student workout MVP. | Highly sensitive. |
| Schedule route | `src/app/api/schedule/route.ts` | D/C | Server-side Airtable schedule logic for website booking. | Not student workout MVP. | Uses Airtable env. |
| Support chat route | `src/app/api/support-chat/route.ts` | D/C | n8n webhook proxy; not student messaging. | Review before any mobile support feature. | Webhook secret/server integration. |
