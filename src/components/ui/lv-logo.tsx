export function LVLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="lv-bg" x1="0" y1="0" x2="48" y2="48">
          <stop offset="0%" stopColor="#4a5d3a" />
          <stop offset="100%" stopColor="#3b4a2e" />
        </linearGradient>
      </defs>

      {/* 배경 - 이끼색 라운드 사각형 */}
      <rect width="48" height="48" rx="12" fill="url(#lv-bg)" />

      {/* L 글자 - 화이트 */}
      <path
        d="M11 12 L11 34 L22.5 34"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* V 글자 - 화이트 */}
      <path
        d="M24 12 L31 34 L38 12"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* 하단 장식 라인 */}
      <line x1="11" y1="38" x2="38" y2="38" stroke="#ffffff" strokeWidth="0.8" opacity="0.3" strokeLinecap="round" />
    </svg>
  );
}

export function LVLogoText({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LVLogo size={size} />
      <span
        className="font-bold tracking-[-0.02em] text-[#191F28] leading-tight"
        style={{ fontSize: size * 0.47 }}
      >
        LV ERP
      </span>
    </div>
  );
}
