"use client";

export function ClipboardNotification({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[45] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 sm:top-6">
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-emerald-200 bg-white/95 px-4 py-2.5 text-center text-sm font-semibold leading-5 text-emerald-800 shadow-xl shadow-slate-900/10 backdrop-blur"
      >
        <span className="block min-w-0 break-words">{message}</span>
      </div>
    </div>
  );
}
