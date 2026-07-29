# Open Questions

## Product Decisions

1. Should student mobile use magic links, OTP codes, or password-based auth?
2. Should the student app be online-first only for MVP, or support offline workout execution?
3. Can students mark workouts complete, or only view assigned workouts initially?
4. If completion is in MVP, what is the exact completion model: workout-level, exercise-level, set-level, or all three?
5. Should students be able to leave feedback per workout or per exercise?
6. Should coaches see student completion/feedback inside the trainer web app in MVP?
7. Should rest timers parse raw `rest` text or require normalized duration fields?
8. Should student app show full calendar history, upcoming agenda only, or both?
9. Should the student see program context, or only individual scheduled workouts?
10. What should happen when a coach edits a workout while a student is doing it?

## API Decisions

1. What mobile auth token format should the backend issue and validate?
2. Should mobile tokens share the existing auth service session model or use a separate mobile session?
3. What student-safe endpoints are required for first MVP?
4. Should workout detail responses include full exercise/video metadata, or should the app fetch exercise details separately?
5. Should create/update completion endpoints return authoritative nested IDs/state after every mutation?
6. What are the conflict rules for offline completion sync?
7. Should the mobile app ever call Supabase directly with row-level security, or only this backend API? Current recommendation: backend API only.

## Design Decisions

1. Confirm canonical product background: recommended `#F5F6FB` vs Tailwind `brand.light` `#F5F6FF`.
2. Confirm mobile font: system font vs bundled brand font.
3. Choose icon library and icon style.
4. Decide dark-mode MVP scope.
5. Define app icon, splash, and notification icon assets.
6. Decide whether empty states remain text-only or use illustrations.
7. Define completion colors separate from generic success, if needed.

## Content Decisions

1. Confirm Russian copy style for student app: informal "ты" is used in marketing; LK trainer UI uses concise operational copy.
2. Define coach note vs student note labels.
3. Define video unavailable copy.
4. Define empty workout day copy.
5. Define completion celebration copy and whether haptics are used.

## Security Decisions

1. Confirm mobile token storage: Expo SecureStore or another native secure storage.
2. Confirm token expiration and renewal behavior.
3. Confirm whether Cloudflare Stream iframe URLs are acceptable in mobile or need native playback URLs.
4. Confirm whether exercise videos require signed access or are public-by-URL.
5. Confirm student authorization model for viewing historical workouts after access expires.
6. Confirm privacy requirements for analytics/error reporting.

## Technical Cleanup Before Mobile Work

1. Extract pure date helpers from `src/components/lk/LkStudentCalendar.tsx` only if they will be shared.
2. Extract metric formatting helpers from `src/components/lk/LkProgramEditor.tsx` only after mobile metric rules are approved.
3. Define DTOs in a shared-neutral form, separate from server-only Supabase modules.
4. Add student-specific API tests before mobile consumes endpoints.
5. Add server-side guards rejecting `optimistic-*` IDs on any persisted UUID endpoint if not already universal.
