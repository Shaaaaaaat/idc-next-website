"use client";

import { useState } from "react";

export function LkLoginForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <form
      action="/lk/login/request"
      method="post"
      className="space-y-4"
      onSubmit={() => setIsSubmitting(true)}
    >
      <div>
        <label htmlFor="email" className="block text-sm text-brand-muted mb-2">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="name@example.com"
          className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-3 text-sm font-semibold text-white shadow-soft hover:bg-brand-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50 disabled:opacity-70 disabled:cursor-not-allowed transition-all"
      >
        {isSubmitting ? "Отправляем..." : "Войти"}
      </button>
    </form>
  );
}

