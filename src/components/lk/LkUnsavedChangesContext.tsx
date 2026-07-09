"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const UNSAVED_CHANGES_CONFIRM_MESSAGE = "Изменения не будут сохранены. Выйти без сохранения?";

type LkUnsavedChangesContextValue = {
  isDirty: boolean;
  setIsDirty: (dirty: boolean) => void;
  confirmLeave: () => boolean;
};

const LkUnsavedChangesContext = createContext<LkUnsavedChangesContextValue | null>(null);

export function LkUnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [isDirty, setIsDirty] = useState(false);

  const confirmLeave = useCallback(() => {
    if (!isDirty) return true;
    return window.confirm(UNSAVED_CHANGES_CONFIRM_MESSAGE);
  }, [isDirty]);

  const value = useMemo(
    () => ({ isDirty, setIsDirty, confirmLeave }),
    [isDirty, confirmLeave]
  );

  return <LkUnsavedChangesContext.Provider value={value}>{children}</LkUnsavedChangesContext.Provider>;
}

export function useLkUnsavedChanges() {
  return useContext(LkUnsavedChangesContext);
}

export function useLkUnsavedChangesOptional() {
  const ctx = useContext(LkUnsavedChangesContext);
  if (!ctx) {
    return {
      isDirty: false,
      setIsDirty: () => {},
      confirmLeave: () => true,
    };
  }
  return ctx;
}
