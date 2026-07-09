# LK Program Template Diff Save Tests

Manual/integration checklist for the diff-based `save_program_template_diff` RPC.

## Setup

- Use a coach-owned program template, not a global template.
- Keep a DB snapshot of `program_templates`, `program_template_workouts`, `program_template_exercise_groups`, and `program_template_exercises` before each destructive test.
- For rollback tests, run against a local Supabase database or a disposable branch/project.

## Core Cases

- Save a program without changes. Existing workout, group, and exercise row ids should remain unchanged.
- Add a workout. Only one `program_template_workouts` row should be inserted.
- Delete a workout. Only that workout and its child rows should be removed.
- Rename a workout. Only that workout row should update.
- Reorder workouts. Existing workout ids should remain stable; `sort_order`, `day_number`, and `week_number` should update.
- Add an exercise. Only one `program_template_exercises` row should be inserted.
- Delete an exercise. Only that exercise row should be deleted.
- Reorder solo exercises. Existing exercise ids should remain stable; only `sort_order` should change.
- Create a combo from two exercises. A group row should be inserted and the exercises should point to it.
- Delete a combo. The group row should be removed and exercises should be ungrouped or removed according to the UI payload.
- Save an empty workout. The workout row should remain with no child rows.

## Failure And Concurrency Cases

- Send a payload where an exercise references a missing `groupDraftId`. RPC should return `invalid` and no rows should change.
- Send a payload with a workout id from another program. RPC should return `invalid` and no rows should change.
- Save with a stale `expectedUpdatedAt`. API should return `409`/`stale`; UI should show the stale edit message.
- Trigger two saves in parallel. One should win deterministically; the other should be stale or lock-serialized without mixed child state.
- Force an error during child mutation in a local DB. Existing program rows should remain intact after rollback.

## Global Template Case

- Attempt to save a global template (`coach_id is null`). RPC should return `forbidden`.
