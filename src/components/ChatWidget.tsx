// src/components/ChatWidget.tsx
"use client";

import { useState, useRef, useEffect, FormEvent } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "bot";
  text: string;
};

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "bot",
      text: "Привет! Я бот поддержки I Do Calisthenics. Задай мне вопрос о курсах, оплате или тренировках 🙌",
    },
  ]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  function toggleOpen() {
    setIsOpen((prev) => !prev);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || isSending) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch("/api/support-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.text,
          history: messages.map((m) => ({
            role: m.role,
            text: m.text,
          })),
        }),
      });

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "bot",
            text: "Сервер поддержки сейчас недоступен. Попробуй ещё раз позже 🙏",
          },
        ]);
        return;
      }

      const data = await res.json();
      const reply = data.reply ?? "Ответ сервера не получен 😕";

      setMessages((prev) => [
        ...prev,
        { id: `bot-${Date.now()}`, role: "bot", text: reply },
      ]);
    } catch (err) {
      console.error("Ошибка /api/support-chat:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "bot",
          text: "Произошла ошибка на сервере. Попробуй позже 🙏",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      {/* Плавающая кнопка (розовый/фиолетовый стиль как раньше) */}
      <button
        type="button"
        onClick={toggleOpen}
        className={[
          "fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40",
          "inline-flex items-center gap-2 rounded-full",
          "bg-brand-primary text-white", // ← возвращаем оригинальный цвет
          "px-4 py-2.5 text-xs sm:text-sm font-semibold",
          "shadow-lg shadow-black/40 hover:bg-brand-primary/90 transition-all",
        ].join(" ")}
      >
        <span className="hidden sm:inline">Чат поддержки</span>
        <span className="sm:hidden">Чат</span>
        <span className="text-lg leading-none">💬</span>
      </button>

      {isOpen && (
        <div
          className="
            fixed bottom-20 right-4 sm:bottom-24 sm:right-6 z-40
            w-[92vw] max-w-sm
            rounded-3xl bg-brand-dark border border-white/10 shadow-2xl shadow-black/60
            flex flex-col overflow-hidden max-h-[70vh]
          "
        >
          {/* Хедер */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/30">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-brand-primary/20 flex items-center justify-center text-sm">
                🤖
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">Поддержка IDC</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-primary/20 px-2 py-[2px] text-[10px] font-medium text-brand-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-primary animate-pulse" />
                    онлайн
                  </span>
                </div>
                <div className="text-[11px] text-brand-muted">
                  Бот-помощник по курсам и оплате
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={toggleOpen}
              className="rounded-full bg-white/5 p-1 text-brand-muted hover:bg-white/10 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Быстрые подсказки */}
          {messages.length <= 2 && (
            <div className="px-3 pb-1 sm:px-4 sm:pb-2 text-[10px] sm:text-[11px] text-brand-muted flex flex-wrap gap-2">
              <span>Попробуй спросить:</span>
              {[
                "Какой курс мне выбрать?",
                "Сколько тренироваться в неделю?",
                "Как оплатить из другой страны?",
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setInput(q)}
                  className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 hover:bg-white/10 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Сообщения */}
          <div className="flex-1 px-3 py-3 sm:px-4 sm:py-4 overflow-y-auto text-[11px] sm:text-xs space-y-2">
            {messages.map((m) => (
              <div
                key={m.id}
                className={[
                  "max-w-[85%] rounded-2xl px-3 py-2",
                  m.role === "user"
                    ? "ml-auto bg-brand-primary text-white rounded-br-sm"
                    : "mr-auto bg-white/5 text-white/90 rounded-bl-sm",
                ].join(" ")}
              >
                {m.text}
              </div>
            ))}

            {isSending && (
              <div className="mr-auto bg-white/5 text-white/80 rounded-2xl rounded-bl-sm px-3 py-2 inline-flex items-center gap-2 text-[11px]">
                <span>Печатает</span>
                <span className="inline-flex gap-1">
                  <span className="w-1 h-1 rounded-full bg-white/50 animate-bounce [animation-delay:-0.2s]" />
                  <span className="w-1 h-1 rounded-full bg-white/50 animate-bounce [animation-delay:-0.1s]" />
                  <span className="w-1 h-1 rounded-full bg-white/50 animate-bounce" />
                </span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Поле ввода */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-white/10 bg-black/30 px-3 py-2.5 sm:px-4 sm:py-3"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Спроси о курсе, оплате или тренировках…"
                className="flex-1 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-[11px] sm:text-xs outline-none focus:border-brand-primary"
              />

              <button
                type="submit"
                disabled={isSending || !input.trim()}
                className="shrink-0 rounded-full bg-brand-primary text-white px-3 py-2 text-[11px] sm:text-xs font-semibold disabled:opacity-50 disabled:pointer-events-none hover:bg-brand-primary/90 transition-colors"
              >
                Отпр.
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
