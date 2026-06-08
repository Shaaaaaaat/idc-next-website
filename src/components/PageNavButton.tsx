import Link from "next/link";
import type { ReactNode } from "react";

type PageNavButtonProps = {
  href: string;
  children: ReactNode;
};

export function PageNavButton({ href, children }: PageNavButtonProps) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 text-sm font-medium text-brand-muted transition-colors hover:text-brand-dark"
    >
      <span aria-hidden className="text-base leading-none">←</span>
      <span>{children}</span>
    </Link>
  );
}
