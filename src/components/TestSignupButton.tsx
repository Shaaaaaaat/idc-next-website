// src/components/TestSignupButton.tsx
"use client";

type TestSignupButtonProps = {
  label?: string;
  buttonClassName?: string;
  onClick?: () => void;
};

export function TestSignupButton({
  label = "Пройти тест силы",
  buttonClassName,
  onClick,
}: TestSignupButtonProps) {
  const defaultButtonClasses =
    "inline-flex items-center justify-center rounded-full bg-brand-primary px-6 py-3 text-sm sm:text-base font-semibold shadow-soft hover:bg-brand-primary/90 transition-colors";

  return (
    <button
      type="button"
      className={buttonClassName || defaultButtonClasses}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
