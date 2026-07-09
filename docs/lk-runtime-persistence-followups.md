# LK Runtime Persistence Follow-Ups

Follow-up work after Program Template diff-save lands.

## Runtime Workout Save

Target: `src/lib/supabase/coachWorkouts.ts` `saveCoachWorkout()`.

- Replace delete-all + insert-all of `client_program_exercises` and `client_program_exercise_groups` with a transaction-safe diff RPC.
- Preserve stable runtime group/exercise row ids in `LkStudentCalendar` draft and save payload.
- Scope updates by `coach_id` in addition to `workoutId` and `clientId`.
- Add optimistic concurrency for workout edits.
- Keep workout date/title updates and child row diff in the same transaction.

## Program Assignment

Target: `src/lib/supabase/programTemplates.ts` `assignProgramTemplate()`.

- Add an idempotent assignment model, for example `client_program_template_assignments`.
- Add a unique key for `(client_id, coach_id, program_template_id, start_date)` or an explicit idempotency key.
- Move assignment into an RPC that creates assignment, runtime workouts, groups, and exercises in one transaction.
- Consider source links:
  - `client_program_workouts.source_template_workout_id`
  - `client_program_exercise_groups.source_template_group_id`
  - `client_program_exercises.source_template_exercise_id`

## Active Client Program Race

Target: `ensureActiveClientProgram()` in both program template and runtime workout helpers.

- Add a unique partial index that allows only one active `client_programs` row per `(client_id, coach_id)`.
- Replace select-then-insert with insert-on-conflict or RPC lock semantics.

## Exercise Library Ownership

Target: `src/lib/supabase/exerciseLibrary.ts`.

- Enforce `created_by_coach_id` ownership or define a shared-library policy before allowing update/delete.
- Prefer soft delete for referenced exercises.
- Add Cloudflare cleanup/compensation for video replacement and failed complete-upload flows.
