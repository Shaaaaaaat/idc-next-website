"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LkStudentWorkoutReview } from "@/components/lk/LkStudentWorkoutReview";
import type { CoachWorkout } from "@/lib/supabase/coachWorkouts";
import type { CoachNotificationItem, CoachNotificationSummary } from "@/lib/supabase/coachNotifications";

type Placement = "sidebar" | "header";

type Props = {
  placement?: Placement;
};

type SummaryResponse =
  | { ok: true; summary: CoachNotificationSummary }
  | { ok: false; error?: string; message?: string };

type WorkoutDetailResponse =
  | { ok: true; workout: CoachWorkout }
  | { ok: false; error?: string; message?: string };

type MarkViewedResponse =
  | { ok: true; viewed?: boolean; coachViewedAt?: string; alreadyViewed?: boolean }
  | { ok: false; error?: string; message?: string };

type PreviewState = {
  item: CoachNotificationItem;
  workout: CoachWorkout;
};

type PanelPosition = {
  top: number;
  left: number;
};

type LoadErrorKind = "unauthorized" | "forbidden" | "transient";

class NotificationLoadError extends Error {
  readonly kind: LoadErrorKind;

  constructor(message: string, kind: LoadErrorKind) {
    super(message);
    this.name = "NotificationLoadError";
    this.kind = kind;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function pluralRu(value: number, one: string, few: string, many: string) {
  const abs = Math.abs(value);
  const lastTwo = abs % 100;
  const last = abs % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getApiErrorMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  const message = value.message;
  if (typeof message === "string" && message.trim()) return message;
  const error = value.error;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function isUnauthorizedMessage(message: string) {
  const normalized = message.trim().toLowerCase();
  return normalized === "unauthorized" || normalized.includes("сессия");
}

function isForbiddenMessage(message: string) {
  return message.trim().toLowerCase() === "forbidden";
}

function safeUiErrorMessage(message: string) {
  if (isUnauthorizedMessage(message)) {
    return "Сессия истекла. Обнови страницу или войди снова.";
  }

  if (isForbiddenMessage(message)) {
    return "У этой учётной записи нет доступа к уведомлениям тренера.";
  }

  return message;
}

function loadErrorKindFromStatus(status: number): LoadErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return "transient";
}

function loadErrorMessage(kind: LoadErrorKind, message: string) {
  if (kind === "unauthorized") return "Сессия истекла. Обнови страницу или войди снова.";
  if (kind === "forbidden") return "У этой учётной записи нет доступа к уведомлениям тренера.";
  return message;
}

function isSummarySuccess(value: unknown): value is Extract<SummaryResponse, { ok: true }> {
  return isRecord(value) && value.ok === true && "summary" in value;
}

function isWorkoutDetailSuccess(value: unknown): value is Extract<WorkoutDetailResponse, { ok: true }> {
  return isRecord(value) && value.ok === true && "workout" in value;
}

function isMarkViewedSuccess(value: unknown): value is Extract<MarkViewedResponse, { ok: true }> {
  return isRecord(value) && value.ok === true;
}

function formatDate(raw?: string | null) {
  const value = String(raw || "").trim();
  if (!value) return "—";
  const d = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function formatDateTime(raw?: string | null) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const d = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function emptySummary(): CoachNotificationSummary {
  return {
    awaitingReviewCount: 0,
    unreadCount: 0,
    awaitingReviewItems: [],
    unsubmittedVideoItems: [],
    generatedAt: new Date().toISOString(),
  };
}

function itemKey(item: CoachNotificationItem) {
  return `${item.kind}:${item.studentId}:${item.workoutId}`;
}

function summaryHasItems(summary: CoachNotificationSummary) {
  return summary.awaitingReviewItems.length > 0 || summary.unsubmittedVideoItems.length > 0;
}

function buttonClassName(placement: Placement) {
  if (placement === "sidebar") {
    return "flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20";
  }
  return "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-primary/20";
}

function badgeClassName(placement: Placement, count: number, loading: boolean) {
  const hidden = count <= 0 && !loading ? "hidden" : "";
  if (placement === "sidebar") {
    return `${hidden} min-w-5 rounded-full bg-amber-400 px-1.5 py-0.5 text-center text-[11px] font-bold text-slate-950 ${loading ? "animate-pulse" : ""}`;
  }
  return `${hidden} min-w-5 rounded-full bg-amber-500 px-1.5 py-0.5 text-center text-[11px] font-bold text-white ${loading ? "animate-pulse" : ""}`;
}

function panelClassName(placement: Placement) {
  const base =
    "fixed inset-x-3 bottom-3 z-[80] flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-950 shadow-2xl";

  if (placement === "sidebar") {
    return `${base} w-[calc(100vw_-_2rem)] max-h-[calc(100dvh_-_32px)] sm:inset-auto sm:w-[28rem] sm:max-w-[calc(100vw_-_2rem)]`;
  }

  return `${base} max-h-[min(82vh,40rem)] sm:absolute sm:inset-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[28rem]`;
}

function NotificationItemButton({
  item,
  opening,
  onOpen,
}: {
  item: CoachNotificationItem;
  opening: boolean;
  onOpen: (item: CoachNotificationItem) => void;
}) {
  const isAwaiting = item.kind === "awaiting_review";
  const subtitle = isAwaiting
    ? item.isUnread
      ? "Новое, ждёт проверки"
      : "Просмотрено"
    : `${item.videoCount || 0} ${pluralRu(item.videoCount || 0, "видео", "видео", "видео")}`;
  const timeLabel = isAwaiting ? formatDateTime(item.submittedAt) : formatDateTime(item.lastVideoAt);

  return (
    <button
      type="button"
      disabled={opening}
      onClick={() => onOpen(item)}
      className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-primary/20 ${
        item.isUnread
          ? "border-amber-200 bg-amber-50 hover:bg-amber-100/70"
          : "border-slate-200 bg-white hover:bg-slate-50"
      } ${opening ? "cursor-wait opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-words text-sm font-semibold text-slate-950">{item.studentName}</p>
            {item.isUnread ? <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="Новое" /> : null}
          </div>
          <p className="mt-1 break-words text-sm text-slate-700">{item.workoutTitle}</p>
          <p className="mt-1 text-xs text-slate-500">
            {formatDate(item.workoutDate)}
            {timeLabel ? ` · ${timeLabel}` : ""}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          {subtitle}
        </span>
      </div>
    </button>
  );
}

function Section({
  title,
  description,
  emptyText,
  items,
  openingKey,
  onOpen,
}: {
  title: string;
  description: string;
  emptyText: string;
  items: CoachNotificationItem[];
  openingKey: string;
  onOpen: (item: CoachNotificationItem) => void;
}) {
  return (
    <section>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <NotificationItemButton
              key={itemKey(item)}
              item={item}
              opening={openingKey === itemKey(item)}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
          {emptyText}
        </p>
      )}
    </section>
  );
}

export function LkCoachNotificationCenter({ placement = "sidebar" }: Props) {
  const [summary, setSummary] = useState<CoachNotificationSummary>(() => emptySummary());
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasSuccessfulLoad, setHasSuccessfulLoad] = useState(false);
  const [blockingError, setBlockingError] = useState("");
  const [blockingErrorKind, setBlockingErrorKind] = useState<LoadErrorKind | "">("");
  const [refreshError, setRefreshError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [openingKey, setOpeningKey] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const hasSuccessfulLoadRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const loadSummary = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    if (mode === "initial") {
      setLoading(true);
      if (!hasSuccessfulLoadRef.current) {
        setBlockingError("");
        setBlockingErrorKind("");
      }
    } else {
      setRefreshing(true);
    }
    setRefreshError("");

    try {
      const res = await fetch("/api/lk/coach/notifications", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as unknown;

      if (requestIdRef.current !== requestId) return;
      if (!res.ok) {
        const kind = loadErrorKindFromStatus(res.status);
        throw new NotificationLoadError(getApiErrorMessage(json, "Не удалось загрузить уведомления."), kind);
      }

      if (!isSummarySuccess(json)) {
        throw new NotificationLoadError(getApiErrorMessage(json, "Не удалось загрузить уведомления."), "transient");
      }

      setSummary(json.summary);
      hasSuccessfulLoadRef.current = true;
      setHasSuccessfulLoad(true);
      setBlockingError("");
      setBlockingErrorKind("");
      setRefreshError("");
    } catch (loadError) {
      if (controller.signal.aborted || requestIdRef.current !== requestId) return;
      const kind = loadError instanceof NotificationLoadError ? loadError.kind : "transient";
      const rawMessage = loadError instanceof Error ? loadError.message : "Не удалось загрузить уведомления.";
      const message = loadErrorMessage(kind, rawMessage);

      if (kind === "unauthorized" || kind === "forbidden") {
        setSummary(emptySummary());
        hasSuccessfulLoadRef.current = false;
        setHasSuccessfulLoad(false);
        setPreview(null);
        setOpeningKey("");
        setDetailError("");
        setRefreshError("");
        setBlockingError(message);
        setBlockingErrorKind(kind);
        return;
      }

      if (hasSuccessfulLoadRef.current) {
        setRefreshError("Не удалось обновить уведомления. Показаны последние данные.");
      } else {
        setBlockingError(message);
        setBlockingErrorKind("transient");
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadSummary("initial");
    }, 0);
    return () => {
      window.clearTimeout(timerId);
      abortRef.current?.abort();
    };
  }, [loadSummary]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setHasMounted(true);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    function handleFocus() {
      void loadSummary("refresh");
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadSummary]);

  const updateSidebarPanelPosition = useCallback(() => {
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel) return;

    const buttonRect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelHeight = panelRect.height;
    const panelWidth = panelRect.width;
    const maxTop = Math.max(16, window.innerHeight - panelHeight - 16);
    const maxLeft = Math.max(16, window.innerWidth - panelWidth - 16);

    setPanelPosition({
      top: clamp(buttonRect.top + buttonRect.height / 2 - panelHeight / 2, 16, maxTop),
      left: clamp(buttonRect.right + 12, 16, maxLeft),
    });
  }, []);

  useEffect(() => {
    if (!isOpen || placement !== "sidebar" || !hasMounted) return;

    let frameId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    function schedulePositionUpdate() {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateSidebarPanelPosition();
      });
    }

    schedulePositionUpdate();
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);

    if (panelRef.current && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(schedulePositionUpdate);
      resizeObserver.observe(panelRef.current);
    }

    return () => {
      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
      resizeObserver?.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [hasMounted, isOpen, placement, updateSidebarPanelPosition]);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  function togglePanel() {
    setIsOpen((current) => {
      const next = !current;
      if (next) {
        setPanelPosition(null);
        void loadSummary("refresh");
      }
      return next;
    });
  }

  async function markViewed(item: CoachNotificationItem) {
    const res = await fetch(
      `/api/lk/coach/students/${encodeURIComponent(item.studentId)}/workouts/${encodeURIComponent(item.workoutId)}/viewed`,
      { method: "POST", cache: "no-store", credentials: "same-origin" }
    );
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok || !isMarkViewedSuccess(json)) {
      throw new Error(getApiErrorMessage(json, "Не удалось отметить тренировку просмотренной."));
    }
  }

  async function openWorkout(item: CoachNotificationItem) {
    const key = itemKey(item);
    if (openingKey) return;

    setOpeningKey(key);
    setDetailError("");

    try {
      const res = await fetch(
        `/api/lk/coach/students/${encodeURIComponent(item.studentId)}/workouts/${encodeURIComponent(item.workoutId)}`,
        { method: "GET", cache: "no-store", credentials: "same-origin" }
      );
      const json = (await res.json().catch(() => null)) as unknown;

      if (!res.ok || !isWorkoutDetailSuccess(json)) {
        throw new Error(getApiErrorMessage(json, "Не удалось открыть тренировку."));
      }

      setPreview({ item, workout: json.workout });
      setIsOpen(false);

      if (item.kind === "awaiting_review" && item.isUnread) {
        try {
          await markViewed(item);
          setSummary((current) => ({
            ...current,
            unreadCount: Math.max(0, current.unreadCount - 1),
            awaitingReviewItems: current.awaitingReviewItems.map((currentItem) =>
              currentItem.workoutId === item.workoutId && currentItem.studentId === item.studentId
                ? { ...currentItem, isUnread: false }
                : currentItem
            ),
          }));
          void loadSummary("refresh");
        } catch (viewError) {
          console.warn(
            "[lk/coach-notifications] mark viewed failed",
            viewError instanceof Error ? viewError.message : String(viewError)
          );
        }
      }
    } catch (openError) {
      setDetailError(safeUiErrorMessage(openError instanceof Error ? openError.message : "Не удалось открыть тренировку."));
    } finally {
      setOpeningKey("");
    }
  }

  const count = summary.unreadCount;
  const hasItems = summaryHasItems(summary);
  const isUnauthorizedBlockingError = blockingErrorKind === "unauthorized";
  const isForbiddenBlockingError = blockingErrorKind === "forbidden";
  const showBlockingError = Boolean(blockingError) && !hasSuccessfulLoad;
  const shownSubmittedCount = summary.awaitingReviewItems.length;
  const totalSubmittedCount = summary.awaitingReviewCount;
  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Уведомления тренера"
      className={panelClassName(placement)}
      style={
        placement === "sidebar"
          ? {
              top: panelPosition?.top ?? 16,
              left: panelPosition?.left ?? 16,
              right: "auto",
              bottom: "auto",
              visibility: panelPosition ? "visible" : "hidden",
            }
          : undefined
      }
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Уведомления</p>
          <p className="mt-1 text-xs text-slate-500">
            {count > 0
              ? `${count} ${pluralRu(count, "новая тренировка", "новые тренировки", "новых тренировок")}`
              : "Новых тренировок нет"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshing ? <span className="text-xs text-slate-400">Обновляем...</span> : null}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => {
              setIsOpen(false);
              buttonRef.current?.focus();
            }}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
          >
            Закрыть
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-6">
        {loading && !hasSuccessfulLoad ? (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
            Загружаем уведомления...
          </p>
        ) : showBlockingError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-4 text-sm text-red-700">
            <p>{blockingError}</p>
            {!isForbiddenBlockingError ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (isUnauthorizedBlockingError) {
                      window.location.reload();
                      return;
                    }
                    void loadSummary("initial");
                  }}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-100"
                >
                  {isUnauthorizedBlockingError ? "Обновить страницу" : "Повторить"}
                </button>
                {isUnauthorizedBlockingError ? (
                  <a
                    href="/lk/login"
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-100"
                  >
                    Войти снова
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5">
            {refreshError ? (
              <div
                role="status"
                className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800"
              >
                <p>{refreshError}</p>
                <button
                  type="button"
                  onClick={() => void loadSummary("refresh")}
                  className="mt-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
                >
                  Повторить
                </button>
              </div>
            ) : null}

            {detailError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                {detailError}
              </div>
            ) : null}

            {!hasItems ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-sm text-slate-500">
                Новых тренировок пока нет.
              </p>
            ) : null}

            {summary.awaitingReviewItems.length > 0 ? (
              <Section
                title="Тренировки"
                description="Новые отмечены, просмотренные доступны для повторного открытия."
                emptyText="Новых тренировок пока нет."
                items={summary.awaitingReviewItems}
                openingKey={openingKey}
                onOpen={openWorkout}
              />
            ) : null}
            {totalSubmittedCount > shownSubmittedCount ? (
              <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Показаны {shownSubmittedCount} из {totalSubmittedCount} тренировок
              </p>
            ) : null}

            {summary.unsubmittedVideoItems.length > 0 ? (
              <div className="space-y-2">
                {summary.unsubmittedVideoItems.map((item) => (
                  <NotificationItemButton
                    key={itemKey(item)}
                    item={item}
                    opening={openingKey === itemKey(item)}
                    onOpen={openWorkout}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={placement === "sidebar" ? "relative" : "relative inline-flex"}>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePanel}
        className={buttonClassName(placement)}
        aria-expanded={isOpen}
      >
        <span>Уведомления</span>
        <span className={badgeClassName(placement, count, loading)}>{loading ? "..." : count > 99 ? "99+" : count}</span>
      </button>

      {isOpen && placement === "sidebar" && hasMounted ? createPortal(panel, document.body) : null}
      {isOpen && placement !== "sidebar" ? panel : null}

      {preview ? (
        <LkStudentWorkoutReview
          workout={preview.workout}
          onClose={() => {
            setPreview(null);
            void loadSummary("refresh");
          }}
          calendarHref={preview.item.calendarHref}
          previewMode={preview.item.kind === "unsubmitted_video" ? "draft_video" : undefined}
        />
      ) : null}
    </div>
  );
}
