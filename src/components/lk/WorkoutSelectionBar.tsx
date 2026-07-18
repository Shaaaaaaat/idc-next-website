"use client";

type Props = {
  count: number;
  clipboardCount: number;
  clipboardMode: "copy" | "move" | null;
  onDelete: () => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onClearClipboard: () => void;
  copyDisabled?: boolean;
  copyDisabledReason?: string;
  deleteDisabled?: boolean;
  showDuplicate?: boolean;
};

function workoutPlural(count: number) {
  const abs = Math.abs(count);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return "тренировок";
  if (mod10 === 1) return "тренировка";
  if (mod10 >= 2 && mod10 <= 4) return "тренировки";
  return "тренировок";
}

export function WorkoutSelectionBar({
  count,
  clipboardCount,
  clipboardMode,
  onDelete,
  onCopy,
  onDuplicate,
  onClear,
  onClearClipboard,
  copyDisabled = false,
  copyDisabledReason = "",
  deleteDisabled = false,
  showDuplicate = true,
}: Props) {
  if (count <= 0 && clipboardCount <= 0) return null;

  const clipboardLabel =
    clipboardMode === "move"
      ? `Готово к переносу: ${clipboardCount}. Выберите место вставки на карточке.`
      : clipboardMode === "copy"
      ? `Скопировано: ${clipboardCount}. Выберите место вставки на карточке.`
      : "";

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 rounded-3xl border border-emerald-200 bg-white/95 px-3 py-3 shadow-2xl shadow-slate-900/15 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
            ✓
          </span>
          <div className="min-w-0">
            {count > 0 ? (
              <p className="text-sm font-semibold text-slate-900">
                Выбрано: {count} {workoutPlural(count)}
              </p>
            ) : null}
            {clipboardLabel ? <p className="text-xs text-slate-500">{clipboardLabel}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {count > 0 ? (
            <>
              <button
                type="button"
                onClick={onCopy}
                disabled={copyDisabled}
                title={copyDisabled ? copyDisabledReason : undefined}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
              >
                Копировать
              </button>
              {showDuplicate ? (
                <button
                  type="button"
                  onClick={onDuplicate}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Дублировать
                </button>
              ) : null}
              <button
                type="button"
                onClick={onDelete}
                disabled={deleteDisabled}
                className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Удалить
              </button>
              <button
                type="button"
                onClick={onClear}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100"
              >
                Снять выбор
              </button>
            </>
          ) : null}
          {count > 1 && copyDisabled && copyDisabledReason ? (
            <span className="basis-full px-1 text-xs text-slate-400 sm:basis-auto sm:self-center">
              {copyDisabledReason}
            </span>
          ) : null}
          {clipboardCount > 0 ? (
            <button
              type="button"
              onClick={onClearClipboard}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100"
            >
              Сбросить буфер
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
