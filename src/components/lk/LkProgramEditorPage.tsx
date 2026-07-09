"use client";

import type { ExerciseLibraryItem } from "@/lib/supabase/exerciseLibrary";
import type { ProgramTemplate } from "@/lib/supabase/programTemplates";
import { LkProgramEditor } from "@/components/lk/LkProgramEditor";
import { LkShell } from "@/components/lk/LkShell";
import { LkUnsavedChangesProvider } from "@/components/lk/LkUnsavedChangesContext";

type Props = {
  program: ProgramTemplate;
  exerciseLibrary: ExerciseLibraryItem[];
};

export function LkProgramEditorPage({ program, exerciseLibrary }: Props) {
  return (
    <LkUnsavedChangesProvider>
      <LkShell
        role="coach"
        title={program.title}
        subtitle="Timeline тренировочной системы без реальных дат"
        activeHref="/lk/coach/programs"
        hideHeader
      >
        <LkProgramEditor program={program} exerciseLibrary={exerciseLibrary} />
      </LkShell>
    </LkUnsavedChangesProvider>
  );
}
