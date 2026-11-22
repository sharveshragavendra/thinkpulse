import React, { useId } from 'react';

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'inline' | 'stacked';
  inverted?: boolean;
}

export function BrandMark({ size = 'md', variant = 'inline', inverted = false }: BrandMarkProps) {
  const uid = useId().replace(/:/g, '');
  const gradId = `tpWaveGrad-${uid}`;
  const cloudId = `tpWaveCloud-${uid}`;
  const glowId = `tpWaveGlow-${uid}`;

  if (variant === 'stacked') {
    const svgSize = size === 'lg' ? 'w-24 h-14' : size === 'sm' ? 'w-16 h-10' : 'w-20 h-12';
    const wordSize = size === 'lg' ? 'text-[30px]' : size === 'sm' ? 'text-xl' : 'text-2xl';

    return (
      <div className="inline-flex flex-col items-center select-none whitespace-nowrap shrink-0">
        <svg viewBox="0 0 112 64" className={`${svgSize} overflow-visible`} fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="8" y1="34" x2="104" y2="34" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#9333EA" />
              <stop offset="46%" stopColor="#6D28D9" />
              <stop offset="76%" stopColor="#2563EB" />
              <stop offset="100%" stopColor="#3B82F6" />
            </linearGradient>
            <radialGradient id={cloudId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.58" />
              <stop offset="55%" stopColor="#93C5FD" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#C4B5FD" stopOpacity="0" />
            </radialGradient>
            <filter id={glowId} x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Soft liquid glass lavender-blue cloud halos behind pulse */}
          <ellipse cx="44" cy="34" rx="22" ry="18" fill={`url(#${cloudId})`} />
          <ellipse cx="66" cy="34" rx="20" ry="16" fill={`url(#${cloudId})`} />
          <circle cx="55" cy="24" r="13" fill="#DDD6FE" fillOpacity="0.45" />

          {/* Smooth vibrant violet-to-azure heartbeat pulse line */}
          <path
            d="M 10 35 H 27.5 C 29.8 35 31.2 33.4 32.2 31 L 34.4 25.8 C 35.4 23.4 38.6 23.6 39.4 26.2 L 42.6 37.6 C 43.4 40.3 47 40.2 47.8 37.4 L 54.4 12.2 C 55.3 8.8 59.9 8.8 60.8 12.2 L 69.6 49.4 C 70.5 52.8 75.1 52.8 76.2 49.4 L 81.2 32.8 C 82.1 29.8 85.4 29.4 86.8 32 L 88.2 34.2 C 89 35 90.2 35 91.6 35 H 102"
            stroke={`url(#${gradId})`}
            strokeWidth="5.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${glowId})`}
          />
          {/* Subtle top specular highlight on pulse line */}
          <path
            d="M 10 34.2 H 27.5 C 29.8 34.2 31.2 32.6 32.2 30.2 L 34.4 25 C 35.4 22.6 38.6 22.8 39.4 25.4 L 42.6 36.8 C 43.4 39.5 47 39.4 47.8 36.6 L 54.4 11.4 C 55.3 8 59.9 8 60.8 11.4 L 69.6 48.6 C 70.5 52 75.1 52 76.2 48.6 L 81.2 32 C 82.1 29 85.4 28.6 86.8 31.2 L 88.2 33.4 C 89 34.2 90.2 34.2 91.6 34.2 H 102"
            stroke="#FFFFFF"
            strokeOpacity="0.34"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <span className={`font-display font-extrabold tracking-tight leading-none mt-1 ${wordSize}`}>
          <span className="text-[#0F1035] dark:text-[#F4F2FF]">Think</span>
          <span className="text-[#6D28D9] dark:text-[#C4B5FD]">Pulse</span>
        </span>
      </div>
    );
  }

  const iconSize = size === 'sm' ? 'w-9 h-9' : size === 'lg' ? 'w-11 h-11' : 'w-10 h-10';
  const textSize = size === 'sm' ? 'text-[19px]' : size === 'lg' ? 'text-2xl' : 'text-xl';

  return (
    <div className="inline-flex items-center gap-2.5 select-none whitespace-nowrap shrink-0">
      <div
        className={`${iconSize} relative flex items-center justify-center rounded-full tp-glass-icon p-1.5`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 40 28" className="w-full h-full overflow-visible" fill="none">
          <defs>
            <linearGradient id={gradId} x1="2" y1="14" x2="38" y2="14" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#9333EA" />
              <stop offset="55%" stopColor="#6D28D9" />
              <stop offset="100%" stopColor="#4F46E5" />
            </linearGradient>
          </defs>
          <path
            d="M 2 15.5 H 9.5 L 13 9.5 L 17.2 19 L 22 4.5 L 27.5 23.5 L 31.2 13 L 33.8 15.5 H 38"
            stroke={`url(#${gradId})`}
            strokeWidth="3.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span className={`font-display font-extrabold tracking-tight ${textSize}`}>
        <span className={inverted ? 'text-white' : 'text-[#0F1035] dark:text-[#F4F2FF]'}>Think</span>
        <span className={inverted ? 'text-[#E9D5FF]' : 'text-[#7C3AED] dark:text-[#C4B5FD]'}>Pulse</span>
      </span>
    </div>
  );
}
