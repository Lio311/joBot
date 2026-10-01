// joBot mark: a briefcase whose body reads as a bot's face. The handle doubles as the antenna
// mount; the right eye is lit in the accent colour, like a scanning LED.

export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="10" width="24" height="17" rx="4" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 10V8a2.5 2.5 0 0 1 2.5-2.5h3A2.5 2.5 0 0 1 20 8v2" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M16 5.5V2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="2.4" r="1.5" fill="var(--accent)" />
      <rect x="9" y="14.5" width="14" height="7" rx="3.5" fill="currentColor" opacity="0.09" />
      <circle cx="12.6" cy="18" r="1.55" fill="currentColor" />
      <circle cx="19.4" cy="18" r="1.55" fill="var(--accent)" className="logo-eye" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span dir="ltr" className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">
        jo<span className="text-accent">Bot</span>
      </span>
    </span>
  );
}
