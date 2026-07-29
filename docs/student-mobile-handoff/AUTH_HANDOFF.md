# Authentication and Security Handoff

## Current Authentication Provider

Current LK authentication is implemented through an internal auth service called from `src/lib/auth/lkAuth.ts`.

Server env variables:

- `AUTH_CF_URL`.
- `AUTH_INTERNAL_TOKEN`.
- `AUTH_COOKIE_NAME`.
- `AUTH_COOKIE_SECURE`.
- `AUTH_COOKIE_MAX_AGE`.
- `AUTH_COOKIE_DOMAIN`.
- `AUTH_COOKIE_SAMESITE`.

The auth helper supports:

- Request magic link: `requestMagicLink(email)`.
- Consume magic link: `consumeMagicLink(magicToken)`.
- Validate session: `validateSession(sessionToken)`.
- Revoke session: `revokeSession(sessionToken)`.

Do not move `AUTH_INTERNAL_TOKEN` or auth service calls into a mobile client.

## Current Browser Session Behavior

Current session flow:

1. User submits email form in `src/components/lk/LkLoginForm.tsx`.
2. Form posts to `POST /lk/login/request` in `src/app/lk/login/request/route.ts`.
3. Server requests a magic link and redirects to neutral success page.
4. User opens `/lk/verify?token=...`.
5. `src/app/lk/verify/page.tsx` redirects to `/lk/verify/consume`.
6. `src/app/lk/verify/consume/route.ts` consumes the magic token, receives a `session_token`, stores it in an httpOnly cookie, and redirects to `/lk`.
7. Server pages/routes call `getValidatedSessionEmail()` from `src/lib/auth/lkSession.ts`.
8. `getValidatedSessionEmail()` reads the cookie with `next/headers` and validates the session server-side.

Cookie config:

- httpOnly.
- secure based on env or production.
- sameSite default `lax`.
- path `/`.
- max age default 90 days.

This is browser-specific and Next.js-specific.

## Role Handling

Role resolution is in `src/lib/auth/lkAccess.ts`.

Roles:

- `admin`.
- `coach`.
- `client`.
- `deny`.

Flow:

- Lookup LK user by email.
- Check `lkEnabled`.
- Validate role.
- For `client`, additionally load client record with `getClientForLkByEmail(...)`.

Current routing:

- `src/app/lk/page.tsx` redirects admin to `/lk/admin`, coach to `/lk/coach`, and renders client profile for `client`.
- Coach API routes require `access.type === "coach"`.
- Admin page blocks coach/client.

## Coach / Student Authorization Boundaries

Current coach boundaries:

- Coach workout mutations check coach role and then server helpers verify coach/student ownership through `coach_clients`.
- Program and exercise library routes use coach access and resource ownership helpers.

Current student/client boundary:

- Client profile can show email, balance, and final access day.
- No student workout API routes exist yet.
- Student cannot currently fetch workouts through a dedicated mobile-safe endpoint.

Future mobile must not reuse coach endpoints for student actions.

## Password Reset and Email Verification

There is no password-based login flow in current LK.

The current "verification" is magic-link consumption, not email verification in a password account system.

For mobile, decide whether to use:

- Magic link with universal links/deep links.
- Email OTP.
- Passwordless code.
- Password + reset flow.

Do not label current magic-link flow as password reset.

## Logout

Current browser logout:

- `GET /lk/logout` in `src/app/lk/logout/route.ts`.
- Reads cookie.
- Calls `revokeSession(sessionToken)`.
- Clears cookie.
- Redirects to `/lk/login`.

Mobile logout should:

- Call a mobile logout/revoke endpoint.
- Clear secure token storage locally.
- Reset query/cache state.
- Navigate to sign-in.

## Refresh Token Behavior

No refresh-token flow is visible in this codebase.

The internal auth service validates a single `session_token`; cookie lifetime is controlled by `AUTH_COOKIE_MAX_AGE`.

Before mobile development:

- Confirm whether the auth service supports refresh tokens or session renewal.
- Decide mobile session expiry behavior.
- Decide re-auth UX when token expires.

## Mobile-Safe Recommended Architecture

Recommended:

- Keep the internal auth service server-side.
- Add mobile-specific auth API endpoints in this Next.js backend or a dedicated backend.
- Mobile receives an app session token only after a trusted server exchange.
- Store tokens in Expo SecureStore or another native secure storage mechanism.
- Attach token to API requests through an Authorization header or another explicitly designed mobile-safe mechanism.
- Server validates mobile tokens and resolves role/client identity on every request.

Avoid:

- Browser cookies as the only mobile session mechanism.
- Copying `src/lib/auth/lkSession.ts` into mobile.
- Exposing `AUTH_INTERNAL_TOKEN`.
- Direct Supabase Admin usage from mobile.

## Distinctions To Preserve

Browser session behavior:

- httpOnly cookie.
- Next.js server pages and route handlers.
- Redirect-based auth flow.

Mobile session behavior:

- Secure native token storage.
- Deep-link or OTP handling.
- API request headers.
- Explicit logout/cache clearing.

Server authorization:

- Server validates identity, role, and student ownership.
- Server enforces coach/student boundaries.

Client-side UI permissions:

- Only hide/disable controls for UX.
- Never rely on mobile UI state for authorization.

## Security-Sensitive Areas

Never move these to mobile:

- `src/lib/supabase/server.ts`.
- Supabase service-role or admin client helpers.
- `src/lib/cloudflare/stream.ts` env-dependent upload/verify/delete functions.
- `src/lib/auth/lkAuth.ts` internal token calls.
- Robokassa secrets and payment signature logic.
- Airtable API key usage.
- Telegram bot tokens and n8n webhook secrets.
