# API Contracts

This inventory covers current routes relevant to a future student mobile app. Do not assume coach endpoints are safe for students. Current LK routes rely on browser cookies and server-side role checks.

## Auth Routes

### `POST /lk/login/request`

Current file: `src/app/lk/login/request/route.ts`.

- Auth: public.
- Body: form data with `email`.
- Response: redirect to `/lk/login?sent=1&t={tenant}`.
- Error behavior: neutral success redirect; backend errors are not leaked.
- Mobile suitability: unsuitable as-is because it is form + browser redirect based.
- Mobile action: create mobile auth request endpoint or deep-link magic-link flow.

### `GET /lk/verify/consume?token=...`

Current file: `src/app/lk/verify/consume/route.ts`.

- Auth: public magic token.
- Behavior: consumes magic link through internal auth service, sets httpOnly cookie, redirects to `/lk`.
- Response: redirect; sets cookie named by `AUTH_COOKIE_NAME` or `idc_lk_session`.
- Mobile suitability: unsuitable as-is for native token storage.
- Mobile action: create mobile consume endpoint or deep-link handler that stores a mobile-safe token in secure storage.

### `GET /lk/logout`

Current file: `src/app/lk/logout/route.ts`.

- Auth: browser cookie if present.
- Behavior: revokes session via internal auth service, clears httpOnly cookie, redirects to `/lk/login`.
- Mobile suitability: unsuitable as-is because it clears browser cookies.
- Mobile action: create mobile logout endpoint and clear secure local token.

## Current Client/Profile Support

### Server-rendered `/lk`

Current file: `src/app/lk/page.tsx`.

- Auth: browser cookie validated by `getValidatedSessionEmail()`.
- Role handling: redirects admin/coach to their dashboards; renders client profile for `client`.
- Data: email, balance, final access day from `getClientForLkByEmail(...)`.
- Mobile suitability: UX reference only, not an API.
- Mobile action: add `GET /api/lk/student/profile`.

## Coach Workout Calendar Routes

### `POST /api/lk/coach/students/[id]/workouts`

Current file: `src/app/api/lk/coach/students/[id]/workouts/route.ts`.

- Auth: requires browser session and `coach` role.
- Permissions: `saveCoachWorkout(...)` checks coach owns active student.
- Request body:
  - `workoutDate`: string.
  - `title`: string.
  - `coachComment`: string optional.
  - `groups`: array.
  - `exercises`: array.
- Response success: `{ ok: true, workoutId }`.
- Error shape: `{ ok: false, error, message? }`.
- Optimistic support: create returns only workout ID, not nested exercise/group IDs.
- Authoritative nested IDs: not returned; current UI relies on `router.refresh()`.
- Mobile suitability: coach-only, unsuitable for student mobile.
- Mobile action: students should not create coach workouts unless a new product flow is defined.

### `PUT /api/lk/coach/students/[id]/workouts/[workoutId]`

Current file: `src/app/api/lk/coach/students/[id]/workouts/[workoutId]/route.ts`.

- Auth: coach role.
- Request body:
  - `workoutDate`, `expectedUpdatedAt`, `title`, `coachComment`.
  - `groups`, `exercises`.
- Response success: `{ ok: true, workoutId }`.
- Error shape: `{ ok: false, error, message? }`.
- Concurrency: `expectedUpdatedAt` supports stale detection; stale maps to 409.
- Mobile suitability: coach-only. Student app must not use it to edit assigned workouts.
- Mobile action: student completion/feedback must use separate endpoints.

### `DELETE /api/lk/coach/students/[id]/workouts/[workoutId]`

Current file: `src/app/api/lk/coach/students/[id]/workouts/[workoutId]/route.ts`.

- Auth: coach role.
- Response success: `{ ok: true }`.
- Error shape: `{ ok: false, error, message? }`.
- Mobile suitability: coach-only.
- Mobile action: no student delete in MVP unless product explicitly requires cancellation/removal.

### `POST /api/lk/coach/students/[id]/calendar/import-template-workouts`

Current file: `src/app/api/lk/coach/students/[id]/calendar/import-template-workouts/route.ts`.

- Auth: coach role.
- Request body:
  - `programTemplateId`.
  - `startDate`.
  - `templateWorkoutIds`.
  - optional `workoutDates`.
- Response success:
  - `ok`.
  - `createdWorkouts`.
  - `reusedWorkouts`.
  - `workoutIds`.
  - `importedWorkouts`.
  - `preferenceSaved`.
- Mobile suitability: coach-only.
- Mobile action: student app should consume assigned workouts after import, not import templates.

### `GET /api/lk/coach/students/[id]/calendar/program-preference`

Current file: `src/app/api/lk/coach/students/[id]/calendar/program-preference/route.ts`.

- Auth: coach role.
- Response success: `{ ok: true, programTemplateId }`.
- Mobile suitability: coach-only, not needed for student MVP.

## Coach Program Routes

### `GET /api/lk/coach/programs`

Current file: `src/app/api/lk/coach/programs/route.ts`.

- Auth: coach role.
- Response success: `{ ok: true, programs }`.
- Mobile suitability: coach-only. Use as data-shape reference only.

### `POST /api/lk/coach/programs`

Current file: `src/app/api/lk/coach/programs/route.ts`.

- Auth: coach role.
- Request body: `{ title }`.
- Response success: `{ ok: true, program }`.
- Mobile suitability: coach-only.

### `GET /api/lk/coach/programs/[programId]`

Current file: `src/app/api/lk/coach/programs/[programId]/route.ts`.

- Auth: coach role.
- Response success: `{ ok: true, program }`.
- Mobile suitability: coach-only.

### `PUT /api/lk/coach/programs/[programId]`

Current file: `src/app/api/lk/coach/programs/[programId]/route.ts`.

- Auth: coach role.
- Request body includes title, metadata, tags, expectedUpdatedAt, and workouts.
- Response success: `{ ok: true, program }`.
- Mobile suitability: coach-only.

### `POST /api/lk/coach/programs/[programId]`

Current file: `src/app/api/lk/coach/programs/[programId]/route.ts`.

- Auth: coach role.
- Request body: `{ action: "duplicate" }`.
- Response success: `{ ok: true, program }`.
- Mobile suitability: coach-only.

### `DELETE /api/lk/coach/programs/[programId]`

Current file: `src/app/api/lk/coach/programs/[programId]/route.ts`.

- Auth: coach role.
- Behavior: deactivates program.
- Mobile suitability: coach-only.

## Coach Exercise Routes

### `GET /api/lk/coach/exercises`

Current file: `src/app/api/lk/coach/exercises/route.ts`.

- Auth: coach role.
- Response success: `{ ok: true, exercises }`.
- Mobile suitability: coach-only. Student app needs read-only exercise data scoped to assigned workouts.

### `POST /api/lk/coach/exercises`

Current file: `src/app/api/lk/coach/exercises/route.ts`.

- Auth: coach role.
- Response: 410 `{ ok: false, error: "direct_upload_required", message }`.
- Mobile suitability: not useful.

### `POST /api/lk/coach/exercises/init-upload`

Current file: `src/app/api/lk/coach/exercises/init-upload/route.ts`.

- Auth: coach role.
- Request body: `title`, `fileName`, `fileType`, `fileSize`.
- Allowed types: MP4, QuickTime, WebM.
- Response success: `{ ok: true, provider: "cloudflare", endpoint, videoId, videoUrl, thumbnailUrl }`.
- Security: Cloudflare credentials stay server-side.
- Mobile suitability: coach-only.

### `POST /api/lk/coach/exercises/complete-upload`

Current file: `src/app/api/lk/coach/exercises/complete-upload/route.ts`.

- Auth: coach role.
- Request body: `title`, `videoId`, `description`, `tags`.
- Response success: `{ ok: true, exercise }`.
- Mobile suitability: coach-only.

### `PATCH /api/lk/coach/exercises/[exerciseId]`

Current file: `src/app/api/lk/coach/exercises/[exerciseId]/route.ts`.

- Auth: coach role.
- Request body: title, description, tags, optional videoId, optional isActive.
- Response success: `{ ok: true, exercise }`.
- Mobile suitability: coach-only.

### `DELETE /api/lk/coach/exercises/[exerciseId]`

Current file: `src/app/api/lk/coach/exercises/[exerciseId]/route.ts`.

- Auth: coach role.
- Response success: `{ ok: true, exercise, archived: true, cloudflareDeleted: false }`.
- Mobile suitability: coach-only.

## Public / Non-LK Routes

### `GET /api/schedule`

Current file: `src/app/api/schedule/route.ts`.

- Public schedule slots for website purchase/trial flow.
- Uses Airtable env vars server-side.
- Mobile suitability: unrelated to student workout MVP unless booking is later in scope.

### `POST /api/support-chat`

Current file: `src/app/api/support-chat/route.ts`.

- Public-ish support webhook proxy to n8n.
- Request body includes message/history.
- Mobile suitability: not a coach-student message API. Authorization and privacy must be reviewed before use.

### Payment and Robokassa routes

Current files:

- `src/app/api/create-payment/route.ts`.
- `src/app/api/check-payment/route.ts`.
- `src/app/api/robokassa/result/route.ts`.

Mobile suitability:

- Website purchase/payment flows, not student workout MVP.
- Security-sensitive env usage. Do not move into mobile.

## Direct Supabase Access

Server helpers under `src/lib/supabase/*` use Supabase Admin and must stay server-only:

- `coachWorkouts.ts`.
- `programTemplates.ts`.
- `exerciseLibrary.ts`.
- `coachStudents.ts`.
- `lkClients.ts`.
- `lkUsers.ts`.
- `server.ts`.

Mobile app should call student-safe API routes, not Supabase Admin helpers directly.

## Required Student API Work Before Mobile Development

Minimum missing endpoints:

- `POST /api/lk/mobile/auth/request` or equivalent mobile magic-link/OTP request.
- `POST /api/lk/mobile/auth/consume` or equivalent token exchange/deep-link consume endpoint.
- `POST /api/lk/mobile/auth/logout`.
- `GET /api/lk/student/profile`.
- `GET /api/lk/student/workouts?fromDate&toDate`.
- `GET /api/lk/student/workouts/[workoutId]`.
- `GET /api/lk/student/exercises/[exerciseId]` or include exercise/video metadata in workout responses.
- Student-safe video playback policy endpoint if Cloudflare iframe URLs are not sufficient in React Native.
- Completion endpoints if active workout is in MVP:
  - `POST /api/lk/student/workouts/[workoutId]/start`.
  - `PATCH /api/lk/student/workouts/[workoutId]/completion`.
  - `PATCH /api/lk/student/workouts/[workoutId]/exercises/[exerciseRowId]/completion`.
- Feedback endpoint if student comments are in MVP:
  - `POST /api/lk/student/workouts/[workoutId]/feedback`.

Authorization to review:

- Student can only read their own workouts.
- Student cannot mutate coach-authored workout definitions unless explicitly allowed.
- Student completion/feedback must be separated from trainer planning data.
- Server must reject `optimistic-*` IDs for persisted UUID routes.

Router refresh reliance:

- Trainer web uses `router.refresh()` after create/import/update flows to reload authoritative nested data.
- Mobile will need API responses or explicit refetches through its query/cache layer. Do not rely on Next.js router refresh.
