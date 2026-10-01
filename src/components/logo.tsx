// diraBot mark: a roofline whose interior reads as a bot's face. The antenna doubles as
// the roof's chimney; the right eye is lit in the accent colour, like a scanning LED.

export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path
        d="M5.5 14.2 15 6.4a1.6 1.6 0 0 1 2 0l9.5 7.8V24.5a3 3 0 0 1-3 3h-15a3 3 0 0 1-3-3V14.2Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M16 6V2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="2.4" r="1.5" fill="var(--accent)" />
      <rect x="9.5" y="15.5" width="13" height="7" rx="3.5" fill="currentColor" opacity="0.09" />
      <circle cx="12.9" cy="19" r="1.55" fill="currentColor" />
      <circle cx="19.1" cy="19" r="1.55" fill="var(--accent)" className="logo-eye" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">
        dira<span className="text-accent">Bot</span>
      </span>
    </span>
  );
}
