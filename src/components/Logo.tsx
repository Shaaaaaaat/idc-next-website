// src/components/Logo.tsx
import Image from "next/image";

type LogoProps = {
  className?: string;
  priority?: boolean;
};

export function Logo({ className, priority = false }: LogoProps) {
  return (
    <div className={`flex items-center gap-2 shrink-0 ${className ?? ""}`}>
      <Image
        src="/logo-idc-white1.svg"
        alt="I Do Calisthenics — логотип"
        width={150}
        height={40}
        className="h-7 w-auto sm:h-8 lg:h-9"
        priority={priority}
      />
      <span className="inline-block w-[148px] sm:w-[172px] lg:w-[196px] text-base sm:text-lg font-medium tracking-tight whitespace-nowrap leading-none h-7 sm:h-8 lg:h-9 flex items-center">
        I&nbsp;Do&nbsp;Calisthenics
      </span>
    </div>
  );
}

