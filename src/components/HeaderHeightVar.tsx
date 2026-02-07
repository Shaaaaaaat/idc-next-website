// src/components/HeaderHeightVar.tsx
"use client";

import { useEffect } from "react";

export function HeaderHeightVar() {
  useEffect(() => {
    const root = document.documentElement;

    const setHeaderHeight = () => {
      const header = document.querySelector("header.sticky") as HTMLElement | null;
      if (!header) return;
      const h = header.getBoundingClientRect().height;
      if (h && Number.isFinite(h)) {
        root.style.setProperty("--header-h", `${Math.round(h)}px`);
      }
    };

    setHeaderHeight();
    const onResize = () => setHeaderHeight();
    window.addEventListener("resize", onResize);

    // На случай динамической смены высоты — наблюдаем за самим хедером
    const header = document.querySelector("header.sticky") as HTMLElement | null;
    let ro: ResizeObserver | null = null;
    if (header && "ResizeObserver" in window) {
      ro = new ResizeObserver(() => setHeaderHeight());
      ro.observe(header);
    }

    // Повторная попытка, если хедер отрендерился позже
    const t = setTimeout(setHeaderHeight, 300);

    return () => {
      window.removeEventListener("resize", onResize);
      if (ro && header) ro.unobserve(header);
      clearTimeout(t);
    };
  }, []);

  return null;
}

