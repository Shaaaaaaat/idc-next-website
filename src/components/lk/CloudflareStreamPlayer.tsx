"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SDK_SCRIPT_ID = "cloudflare-stream-player-sdk";
const SDK_SCRIPT_SRC = "https://embed.cloudflarestream.com/embed/sdk.latest.js";
const SDK_LOAD_TIMEOUT_MS = 7000;
const PLAYER_READY_TIMEOUT_MS = 7000;
const DEFAULT_RATE = 1;
const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

type SpeedOption = (typeof SPEED_OPTIONS)[number];
type MenuPosition = { left: number; top: number };

type CloudflareStreamEventHandler = () => void;

type CloudflareStreamPlayerHandle = {
  playbackRate: number;
  currentTime?: number;
  duration?: number;
  readyState?: number;
  addEventListener?: (type: "loadedmetadata" | "ratechange", listener: CloudflareStreamEventHandler) => void;
  removeEventListener?: (type: "loadedmetadata" | "ratechange", listener: CloudflareStreamEventHandler) => void;
};

declare global {
  interface Window {
    Stream?: (iframe: HTMLIFrameElement) => CloudflareStreamPlayerHandle;
  }
}

type Props = {
  src: string;
  title: string;
  className?: string;
  iframeClassName?: string;
  loading?: "eager" | "lazy";
  showSpeedControl?: boolean;
};

let sdkLoadPromise: Promise<void> | null = null;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatRate(rate: number) {
  return `${Number.isInteger(rate) ? rate.toFixed(0) : rate.toString()}x`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPlaybackRateDescriptor(player: CloudflareStreamPlayerHandle) {
  let current: object | null = player;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "playbackRate");
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function readPlaybackRate(player: CloudflareStreamPlayerHandle) {
  const rate = player.playbackRate;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function hasPlaybackRateControl(player: CloudflareStreamPlayerHandle) {
  const descriptor = getPlaybackRateDescriptor(player);
  const canRead = readPlaybackRate(player) !== null;
  const canSet = Boolean(descriptor && (typeof descriptor.set === "function" || descriptor.writable === true));
  return canRead && canSet;
}

function hasRateChangeSync(player: CloudflareStreamPlayerHandle) {
  return typeof player.addEventListener === "function" && typeof player.removeEventListener === "function";
}

function hasMediaReadyState(player: CloudflareStreamPlayerHandle) {
  if (typeof player.readyState === "number" && player.readyState >= 1) return true;
  return typeof player.duration === "number" && Number.isFinite(player.duration) && player.duration > 0;
}

function loadCloudflareStreamSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Cloudflare Stream SDK can only load in a browser"));
  }

  if (typeof window.Stream === "function") {
    return Promise.resolve();
  }

  if (sdkLoadPromise) {
    return sdkLoadPromise;
  }

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const existingScript = document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existingScript || document.createElement("script");

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };

    const settle = (callback: () => void, shouldRemoveScript = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (shouldRemoveScript && script.parentElement) {
        script.remove();
      }
      callback();
    };

    function handleLoad() {
      if (typeof window.Stream === "function") {
        script.dataset.loaded = "true";
        settle(resolve);
        return;
      }
      settle(() => reject(new Error("Cloudflare Stream SDK loaded without Stream()")), true);
    }

    function handleError() {
      settle(() => reject(new Error("Cloudflare Stream SDK failed to load")), true);
    }

    const timeoutId = window.setTimeout(() => {
      settle(() => reject(new Error("Cloudflare Stream SDK load timed out")), true);
    }, SDK_LOAD_TIMEOUT_MS);

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);

    if (!existingScript) {
      script.id = SDK_SCRIPT_ID;
      script.src = SDK_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    } else if (script.dataset.loaded === "true" && typeof window.Stream === "function") {
      handleLoad();
    }
  }).catch((error: unknown) => {
    sdkLoadPromise = null;
    throw error;
  });

  return sdkLoadPromise;
}

function CloudflareStreamPlayerInner({
  src,
  title,
  className,
  iframeClassName,
  loading = "lazy",
  showSpeedControl = true,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<CloudflareStreamPlayerHandle | null>(null);
  const requestIdRef = useRef(0);
  const initialRateAppliedSrcRef = useRef<string | null>(null);
  const hoverOpenedRef = useRef(false);
  const triggerHoveredRef = useRef(false);
  const menuHoveredRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const positionFrameRef = useRef<number | null>(null);
  const tryEnableControlRef = useRef<(() => void) | null>(null);

  const [isControlAvailable, setIsControlAvailable] = useState(false);
  const [currentRate, setCurrentRate] = useState(DEFAULT_RATE);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [activeRate, setActiveRate] = useState<SpeedOption>(DEFAULT_RATE);

  const activeRateIndex = useMemo(() => {
    const exactIndex = SPEED_OPTIONS.findIndex((rate) => rate === activeRate);
    return exactIndex >= 0 ? exactIndex : SPEED_OPTIONS.findIndex((rate) => rate === DEFAULT_RATE);
  }, [activeRate]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeMenu = useCallback(() => {
    clearCloseTimer();
    hoverOpenedRef.current = false;
    setIsMenuOpen(false);
    setMenuPosition(null);
  }, [clearCloseTimer]);

  const updatePosition = useCallback(() => {
    if (positionFrameRef.current !== null) {
      window.cancelAnimationFrame(positionFrameRef.current);
    }

    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null;
      const button = buttonRef.current;
      const menu = menuRef.current;
      if (!button || !menu) return;

      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const maxTop = Math.max(12, window.innerHeight - menuRect.height - 12);
      const maxLeft = Math.max(12, window.innerWidth - menuRect.width - 12);
      const nextTop = clamp(buttonRect.top - menuRect.height - 8, 12, maxTop);
      const nextLeft = clamp(buttonRect.right - menuRect.width, 12, maxLeft);

      setMenuPosition({ left: nextLeft, top: nextTop });
    });
  }, []);

  const openMenu = useCallback(
    (reason: "hover" | "click" | "keyboard") => {
      if (!isControlAvailable) return;
      clearCloseTimer();
      hoverOpenedRef.current = reason === "hover";
      setActiveRate((previous) => {
        const matchedRate = SPEED_OPTIONS.find((rate) => rate === currentRate);
        return matchedRate ?? previous;
      });
      setIsMenuOpen(true);
    },
    [clearCloseTimer, currentRate, isControlAvailable]
  );

  const scheduleHoverClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      if (!triggerHoveredRef.current && !menuHoveredRef.current) {
        closeMenu();
      }
    }, 120);
  }, [clearCloseTimer, closeMenu]);

  const syncRateFromPlayer = useCallback((player: CloudflareStreamPlayerHandle) => {
    const nextRate = readPlaybackRate(player);
    if (nextRate === null) return false;
    setCurrentRate(nextRate);
    const option = SPEED_OPTIONS.find((rate) => rate === nextRate);
    if (option) setActiveRate(option);
    return true;
  }, []);

  const selectRate = useCallback(
    (rate: SpeedOption) => {
      const player = playerRef.current;
      if (!player) return;

      try {
        player.playbackRate = rate;
        if (!syncRateFromPlayer(player)) {
          setIsControlAvailable(false);
        }
      } catch {
        setIsControlAvailable(false);
      }

      closeMenu();
      buttonRef.current?.focus();
    },
    [closeMenu, syncRateFromPlayer]
  );

  useEffect(() => {
    if (!showSpeedControl) return;

    const iframe = iframeRef.current;
    if (!iframe) return;
    const iframeElement = iframe;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    let removeRateChangeListener: (() => void) | null = null;
    let removeLoadedMetadataListener: (() => void) | null = null;
    let readinessPollingId: number | null = null;
    let readinessTimeoutId: number | null = null;
    let mediaReadyConfirmed = false;
    let rateChangeConfirmed = false;
    let isEnablingControl = false;

    const isCurrentRequest = () => !controller.signal.aborted && requestIdRef.current === requestId;

    const stopReadinessPolling = () => {
      if (readinessPollingId !== null) {
        window.clearInterval(readinessPollingId);
        readinessPollingId = null;
      }
      if (readinessTimeoutId !== null) {
        window.clearTimeout(readinessTimeoutId);
        readinessTimeoutId = null;
      }
    };

    const tryEnableControl = () => {
      if (!isCurrentRequest()) return;
      if (isEnablingControl) return;

      const player = playerRef.current;
      if (!player || !hasPlaybackRateControl(player) || !hasRateChangeSync(player)) return;

      if (hasMediaReadyState(player)) {
        mediaReadyConfirmed = true;
      }

      if (!mediaReadyConfirmed && !rateChangeConfirmed) return;

      isEnablingControl = true;
      try {
        if (initialRateAppliedSrcRef.current !== src) {
          if (!rateChangeConfirmed) {
            player.playbackRate = DEFAULT_RATE;
          }
          initialRateAppliedSrcRef.current = src;
        }

        if (!syncRateFromPlayer(player)) return;

        setIsControlAvailable(true);
        stopReadinessPolling();
      } catch {
        setIsControlAvailable(false);
      } finally {
        isEnablingControl = false;
      }
    };

    tryEnableControlRef.current = tryEnableControl;

    async function initializePlayer() {
      try {
        await loadCloudflareStreamSdk();
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;

        const createPlayer = window.Stream;
        if (typeof createPlayer !== "function") {
          throw new Error("Cloudflare Stream SDK is unavailable");
        }

        const player = createPlayer(iframeElement);
        if (!hasPlaybackRateControl(player) || !hasRateChangeSync(player)) {
          throw new Error("Cloudflare Stream playback rate synchronization is unavailable");
        }

        const handleRateChange = () => {
          if (!isCurrentRequest()) return;
          rateChangeConfirmed = true;
          if (!syncRateFromPlayer(player)) {
            setIsControlAvailable(false);
            return;
          }
          tryEnableControl();
        };

        const handleLoadedMetadata = () => {
          mediaReadyConfirmed = true;
          tryEnableControl();
        };

        player.addEventListener?.("loadedmetadata", handleLoadedMetadata);
        player.addEventListener?.("ratechange", handleRateChange);
        removeLoadedMetadataListener = () => player.removeEventListener?.("loadedmetadata", handleLoadedMetadata);
        removeRateChangeListener = () => player.removeEventListener?.("ratechange", handleRateChange);
        playerRef.current = player;

        readinessPollingId = window.setInterval(tryEnableControl, 100);
        readinessTimeoutId = window.setTimeout(stopReadinessPolling, PLAYER_READY_TIMEOUT_MS);
        tryEnableControl();
      } catch {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        stopReadinessPolling();
        removeLoadedMetadataListener?.();
        removeRateChangeListener?.();
        playerRef.current = null;
        setIsControlAvailable(false);
      }
    }

    void initializePlayer();

    return () => {
      controller.abort();
      tryEnableControlRef.current = null;
      stopReadinessPolling();
      removeLoadedMetadataListener?.();
      removeRateChangeListener?.();
      playerRef.current = null;
    };
  }, [showSpeedControl, src, syncRateFromPlayer]);

  useEffect(() => {
    if (!isMenuOpen) return;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current);
        positionFrameRef.current = null;
      }
    };
  }, [isMenuOpen, updatePosition]);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeMenu, isMenuOpen]);

  useEffect(() => {
    if (isMenuOpen) updatePosition();
  }, [currentRate, isMenuOpen, updatePosition]);

  useEffect(() => {
    return () => {
      clearCloseTimer();
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current);
      }
    };
  }, [clearCloseTimer]);

  const menu = isMenuOpen
    ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[80] max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-slate-950/95 p-1.5 text-white shadow-2xl backdrop-blur"
          style={{
            left: menuPosition?.left ?? 0,
            top: menuPosition?.top ?? 0,
            visibility: menuPosition ? "visible" : "hidden",
          }}
          role="menu"
          aria-label="Скорость видео"
          onMouseEnter={() => {
            menuHoveredRef.current = true;
            clearCloseTimer();
          }}
          onMouseLeave={() => {
            menuHoveredRef.current = false;
            scheduleHoverClose();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeMenu();
              buttonRef.current?.focus();
              return;
            }

            if (event.key === "Tab") {
              event.preventDefault();
              event.stopPropagation();
              closeMenu();
              buttonRef.current?.focus();
              return;
            }

            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

            event.preventDefault();
            event.stopPropagation();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-speed-option]") || []);
            const focusedIndex = buttons.findIndex((button) => button === document.activeElement);
            const currentIndex = focusedIndex >= 0 ? focusedIndex : activeRateIndex;
            const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
            buttons[nextIndex]?.focus();
          }}
        >
          {SPEED_OPTIONS.map((rate) => {
            const isSelected = Math.abs(currentRate - rate) < 0.001;
            return (
              <button
                key={rate}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                data-speed-option
                onClick={(event) => {
                  event.stopPropagation();
                  selectRate(rate);
                }}
                className={cx(
                  "flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-white/30",
                  isSelected ? "bg-white text-slate-950" : "text-white hover:bg-white/10"
                )}
              >
                <span>{formatRate(rate)}</span>
                {isSelected ? <span aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>,
        document.body
      )
    : null;

  return (
    <div className={cx("relative h-full w-full", className)}>
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        loading={loading}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
        onLoad={() => tryEnableControlRef.current?.()}
        className={cx("h-full w-full", iframeClassName)}
      />

      {showSpeedControl && isControlAvailable ? (
        <button
          ref={buttonRef}
          type="button"
          className="absolute right-3 top-3 z-10 rounded-full border border-white/20 bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur transition-colors hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-white/40"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label={`Скорость видео ${formatRate(currentRate)}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isMenuOpen) {
              if (hoverOpenedRef.current) {
                hoverOpenedRef.current = false;
                return;
              }
              closeMenu();
              return;
            }
            openMenu("click");
          }}
          onMouseEnter={() => {
            triggerHoveredRef.current = true;
            openMenu("hover");
          }}
          onMouseLeave={() => {
            triggerHoveredRef.current = false;
            scheduleHoverClose();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && isMenuOpen) {
              event.preventDefault();
              event.stopPropagation();
              closeMenu();
              return;
            }

            if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              openMenu("keyboard");
              window.requestAnimationFrame(() => {
                const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-speed-option]") || []);
                buttons[activeRateIndex]?.focus();
              });
            }
          }}
        >
          {formatRate(currentRate)}
        </button>
      ) : null}

      {menu}
    </div>
  );
}

export function CloudflareStreamPlayer(props: Props) {
  return <CloudflareStreamPlayerInner key={props.src} {...props} />;
}
