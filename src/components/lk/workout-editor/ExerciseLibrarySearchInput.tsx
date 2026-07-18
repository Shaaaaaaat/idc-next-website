"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export type ExerciseSearchItem = {
  id: string;
  title: string;
};

type Props = {
  value: string;
  selectedExerciseId?: string;
  items: ExerciseSearchItem[];
  autoFocus?: boolean;
  placeholder?: string;
  inputRef?: (node: HTMLInputElement | null) => void;
  inputClassName?: string;
  containerClassName?: string;
  dropdownClassName?: string;
  dropdownWidthClassName?: string;
  isOpen?: boolean;
  showEmptyQueryResults?: boolean;
  maxResults?: number;
  getSearchText?: (value: string) => string;
  onQueryChange: (query: string) => void;
  onSelect: (exerciseId: string, item: ExerciseSearchItem) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
};

function defaultSearchText(value: string) {
  return value.trim().toLowerCase();
}

function mergeClassNames(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export function ExerciseLibrarySearchInput({
  value,
  selectedExerciseId = "",
  items,
  autoFocus = false,
  placeholder = "Найти упражнение в библиотеке",
  inputRef,
  inputClassName,
  containerClassName,
  dropdownClassName,
  dropdownWidthClassName = "w-full",
  isOpen,
  showEmptyQueryResults = true,
  maxResults = 10,
  getSearchText = defaultSearchText,
  onQueryChange,
  onSelect,
  onFocus,
  onBlur,
  onKeyDown,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const isControlledOpen = typeof isOpen === "boolean";
  const open = isControlledOpen ? Boolean(isOpen) : internalOpen;
  const normalizedQuery = getSearchText(value);
  const canShowDropdown = open && (showEmptyQueryResults || Boolean(normalizedQuery));

  const matches = useMemo(() => {
    if (!normalizedQuery && !showEmptyQueryResults) return [];
    const list = normalizedQuery
      ? items.filter((item) => getSearchText(item.title).includes(normalizedQuery))
      : items;
    return list.slice(0, maxResults);
  }, [getSearchText, items, maxResults, normalizedQuery, showEmptyQueryResults]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!canShowDropdown) {
      setAlignRight(false);
      return;
    }

    const container = containerRef.current;
    const dropdown = dropdownRef.current;
    if (!container || !dropdown) return;

    const safeMargin = 16;
    const dropdownRect = dropdown.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const overflowsRight = containerRect.left + dropdownRect.width > window.innerWidth - safeMargin;
    const rightAlignedLeft = containerRect.right - dropdownRect.width;

    setAlignRight(overflowsRight && rightAlignedLeft >= safeMargin);
  }, [canShowDropdown, dropdownWidthClassName, matches.length, value]);

  function clearCloseTimer() {
    if (!closeTimerRef.current) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function handleFocus() {
    clearCloseTimer();
    if (!isControlledOpen) setInternalOpen(true);
    onFocus?.();
  }

  function handleBlur() {
    onBlur?.();
    if (isControlledOpen) return;
    closeTimerRef.current = window.setTimeout(() => {
      setInternalOpen(false);
      closeTimerRef.current = null;
    }, 120);
  }

  function handleSelect(item: ExerciseSearchItem) {
    onSelect(item.id, item);
    if (!isControlledOpen) setInternalOpen(false);
  }

  return (
    <div ref={containerRef} className={mergeClassNames("relative min-w-0 flex-1", containerClassName)}>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => {
          if (!isControlledOpen) setInternalOpen(true);
          onQueryChange(event.target.value);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={onKeyDown}
        className={mergeClassNames(
          "w-full rounded-xl border border-slate-200 px-3 py-2 text-base font-semibold text-slate-950 outline-none placeholder:font-medium placeholder:text-slate-400 focus:border-brand-primary sm:text-lg",
          inputClassName
        )}
        placeholder={placeholder}
      />
      {canShowDropdown ? (
        <div
          ref={dropdownRef}
          className={mergeClassNames(
            "absolute z-50 mt-1 max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl",
            alignRight ? "right-0" : "left-0",
            dropdownWidthClassName,
            dropdownClassName
          )}
        >
          {matches.length > 0 ? (
            matches.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.title}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelect(item)}
                className={mergeClassNames(
                  "block w-full min-w-0 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100",
                  selectedExerciseId === item.id ? "bg-brand-primary/10 text-brand-primary" : "text-slate-700"
                )}
              >
                <span className="block min-w-0 whitespace-normal break-words leading-snug">{item.title}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-slate-400">Ничего не найдено</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
