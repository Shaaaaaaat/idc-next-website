# Student Mobile Handoff

This folder is an audit/export package for a future student mobile app built with React Native + Expo in a separate project. It documents what can be reused, what should only be used as a UX reference, and what must stay server-only.

No mobile project is created here. No trainer app behavior is intentionally changed by this handoff.

## Files

- `DESIGN_SYSTEM.md` - semantic design-system inventory and token rationale.
- `design-tokens.ts` - platform-independent draft tokens for a React Native theme.
- `MOBILE_UX_GUIDELINES.md` - how trainer web patterns should translate to mobile.
- `DOMAIN_MODELS.md` - mobile-oriented domain model reference.
- `API_CONTRACTS.md` - current API route inventory and student API gaps.
- `AUTH_HANDOFF.md` - current auth/session behavior and mobile-safe recommendation.
- `ASSET_INVENTORY.md` - current assets, media conventions, and missing mobile assets.
- `PRODUCT_LANGUAGE.md` - shared product terminology, formatting, color semantics, UI rules, and icon meanings.
- `REUSE_MATRIX.md` - reusable/web-only/server-only classification.
- `OPEN_QUESTIONS.md` - product and technical decisions before mobile development.

## Current Trainer Stack

- Next.js 16, React 19, TypeScript.
- Tailwind CSS 3 with local brand extensions in `tailwind.config.js`.
- Server-side Supabase Admin helpers under `src/lib/supabase/*`.
- Magic-link auth through an internal auth service in `src/lib/auth/lkAuth.ts`.
- Browser sessions stored in an httpOnly cookie read by `src/lib/auth/lkSession.ts`.
- Exercise video upload through Cloudflare Stream TUS endpoints.

## Recommended Future Student App Foundation

Recommended project shape:

```text
student-mobile/
  app/
  src/
    api/
    components/
    features/
    hooks/
    navigation/
    screens/
    theme/
    types/
    utils/
  assets/
```

Recommended choices:

- React Native + Expo + TypeScript.
- Expo Router unless the first MVP requires custom native navigation behavior that React Navigation handles better.
- A `src/theme/` module seeded from `design-tokens.ts`, converted to React Native style objects.
- A dedicated `src/api/` layer that calls student-safe backend routes. Do not call coach routes directly from mobile.
- A query/cache layer such as TanStack Query after student endpoints exist, because workouts, exercise videos, and completion state are server-backed and need refetch/loading/error states.
- Secure token storage through Expo SecureStore or an equivalent native secure storage layer.
- Environment separation for dev/staging/prod API origins. Do not bake production URLs into components.
- Error reporting only after privacy and consent copy are approved.
- Analytics only after event taxonomy and consent rules are approved.

Do not copy web React components, className strings, Tailwind utilities, Next.js route code, server-only helpers, or cookie-based auth helpers into the React Native app.

## Student MVP Screen Map

### Sign In

- Data required: email.
- Existing support: browser magic-link request exists at `src/app/lk/login/request/route.ts`.
- Missing support: mobile-friendly auth request/consume flow that returns or establishes mobile tokens without browser cookies.
- Loading state: sending link or requesting code.
- Empty state: email input only.
- Error state: neutral copy should avoid leaking whether email exists.
- Offline: block submit with local offline message.
- Actions: request sign-in link/code.

### Password Reset

- Current support: not a password flow; current auth is magic-link based.
- Missing support: define whether mobile uses magic links, OTP, or password reset.
- Label as future/auth decision, not existing behavior.

### Today

- Data required: current student profile and workouts for today/upcoming range.
- Existing support: trainer page loads client workout data server-side through `getCoachWorkoutsForStudent(...)`, but only for coaches.
- Missing support: `GET /api/lk/student/workouts?fromDate&toDate`.
- Loading state: skeleton agenda cards.
- Empty state: "На сегодня тренировки нет".
- Error state: retryable API error.
- Offline: show cached last-known workout if available.
- Actions: open workout, watch exercise video, mark completion after completion API exists.

### Workout Details

- Data required: workout, exercise list, groups/combos, metrics, notes, video metadata.
- Existing support: coach data model exists in `src/lib/supabase/coachWorkouts.ts`.
- Missing support: student-safe workout read endpoint.
- Loading state: card skeleton.
- Empty state: no exercises.
- Error state: retry.
- Offline: read-only cached details.
- Actions: open exercise/video, start active workout.

### Active Workout

- Data required: workout details, exercise completion state, set completion state, rest timers.
- Existing support: no student completion model found in current code.
- Missing support: completion entities and endpoints.
- Loading state: resume or start workout.
- Empty state: no active workout.
- Error state: save completion failed, retry queue if supported.
- Offline: requires explicit product decision.
- Actions: complete exercise/set, start rest timer, add feedback if supported later.

### Exercise Details / Video

- Data required: `ExerciseLibraryItem` with `videoUrl`, `thumbnailUrl`, `description`, `tags`.
- Existing support: coach exercise library and video viewer exist.
- Missing support: student-safe exercise lookup and signed/video-safe playback policy.
- Loading state: video player loading.
- Empty state: no video available.
- Error state: video unavailable.
- Offline: likely no video offline in MVP.

### Rest Timer

- Data required: parsed or raw rest metric.
- Existing support: rest is a raw string in workout models.
- Missing support: normalized timer duration rules.
- Loading state: not applicable.
- Empty state: no rest prescribed.
- Error state: unparseable rest stays display-only.

### Calendar / History

- Data required: workouts by date and completion history.
- Existing support: trainer calendar view exists in `src/components/lk/LkStudentCalendar.tsx`.
- Missing support: student agenda/history endpoint and completion history model.
- Mobile pattern: agenda/list, not desktop seven-column grid.

### Progress

- Existing support: no dedicated progress metric model found in current LK code.
- Missing support: progress metric schema, APIs, and product definition.
- Label as future feature.

### Coach Messages / Feedback

- Existing support: workout `coachComment` exists; general support chat exists at `src/app/api/support-chat/route.ts`, but it is not a coach-student message system.
- Missing support: student feedback/comment entities and notification rules.
- Label as future feature unless product narrows scope.

### Profile / Settings

- Data required: email, balance, final access day.
- Existing support: client profile page at `src/app/lk/page.tsx`.
- Missing support: student mobile profile endpoint.
- Actions: logout, auth/session management.

## Platform Scope

Primary: iOS and Android.

Secondary consideration: responsive tablet layouts after phone MVP patterns are stable.

Out of initial scope: HarmonyOS NEXT, watchOS, Wear OS, tvOS, desktop native apps, and mobile web/PWA unless later required.

Keep code reasonably portable, but do not introduce abstractions only for unsupported platforms.
