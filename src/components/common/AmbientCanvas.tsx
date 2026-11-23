import React from 'react';
import { useTheme } from '../../context/ThemeContext.tsx';

interface AmbientCanvasProps {
  variant?: 'pastel' | 'purple';
}

export function AmbientCanvas({ variant = 'pastel' }: AmbientCanvasProps) {
  const { isDark } = useTheme();

  if (variant === 'purple') {
    const dotColor = isDark ? 'rgba(216, 180, 254, 0.28)' : 'rgba(255, 255, 255, 0.72)';
    const gridStroke = isDark ? 'rgba(196, 181, 253, 0.08)' : 'rgba(124, 58, 237, 0.08)';
    const hexStroke = isDark ? 'rgba(221, 214, 254, 0.24)' : 'rgba(255, 255, 255, 0.72)';
    const hexFill = isDark ? 'rgba(139, 92, 246, 0.14)' : 'rgba(255, 255, 255, 0.26)';
    const ringStroke = isDark ? 'rgba(196, 181, 253, 0.30)' : 'rgba(255, 255, 255, 0.80)';
    const facetFill = isDark ? 'rgba(139, 92, 246, 0.16)' : 'rgba(255, 255, 255, 0.34)';

    return (
      <div
        className="fixed inset-0 -z-10 overflow-hidden pointer-events-none select-none"
        aria-hidden="true"
      >
        {/* Soft luminous lavender/purple atmospheric glow pools */}
        <div
          className="absolute -top-28 right-[6%] w-[44rem] h-[38rem] rounded-full opacity-80 blur-3xl"
          style={{
            background: isDark
              ? 'radial-gradient(circle, rgba(139, 92, 246, 0.34) 0%, rgba(109, 40, 217, 0.18) 48%, transparent 74%)'
              : 'radial-gradient(circle, rgba(147, 51, 234, 0.42) 0%, rgba(192, 132, 252, 0.26) 48%, transparent 74%)',
          }}
        />
        <div
          className="absolute top-[30%] -left-24 w-[40rem] h-[40rem] rounded-full opacity-70 blur-3xl"
          style={{
            background: isDark
              ? 'radial-gradient(circle, rgba(99, 102, 241, 0.24) 0%, rgba(124, 58, 237, 0.14) 50%, transparent 74%)'
              : 'radial-gradient(circle, rgba(167, 139, 250, 0.44) 0%, rgba(221, 214, 254, 0.26) 50%, transparent 74%)',
          }}
        />
        <div
          className="absolute -bottom-28 right-[-8%] w-[42rem] h-[40rem] rounded-full opacity-75 blur-3xl"
          style={{
            background: isDark
              ? 'radial-gradient(circle, rgba(124, 58, 237, 0.32) 0%, rgba(88, 28, 135, 0.16) 50%, transparent 74%)'
              : 'radial-gradient(circle, rgba(124, 58, 237, 0.44) 0%, rgba(196, 181, 253, 0.26) 50%, transparent 74%)',
          }}
        />

        {/* Crisp Geometric Pattern: Concentric Luminous Rings, Hexagons, Isometric Glass Facets & Dot Matrix */}
        <svg
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 w-full h-full"
          fill="none"
        >
          <defs>
            <pattern id="tpGeoHexGrid" width="84" height="72.74" patternUnits="userSpaceOnUse">
              <path
                d="M 21 0 L 63 0 L 84 36.37 L 63 72.74 L 21 72.74 L 0 36.37 Z"
                stroke={gridStroke}
                strokeWidth="1"
              />
            </pattern>

            <linearGradient id="tpGeoRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={isDark ? '#DDD6FE' : '#FFFFFF'} stopOpacity={isDark ? '0.52' : '0.92'} />
              <stop offset="50%" stopColor={isDark ? '#A78BFA' : '#C084FC'} stopOpacity={isDark ? '0.32' : '0.62'} />
              <stop offset="100%" stopColor={isDark ? '#7C3AED' : '#FFFFFF'} stopOpacity={isDark ? '0.18' : '0.45'} />
            </linearGradient>

            <linearGradient id="tpGeoFacetGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={isDark ? '#A78BFA' : '#FFFFFF'} stopOpacity={isDark ? '0.26' : '0.64'} />
              <stop offset="100%" stopColor={isDark ? '#4C1D95' : '#DDD6FE'} stopOpacity={isDark ? '0.12' : '0.28'} />
            </linearGradient>

            <pattern id="tpGeoDots" width="18" height="18" patternUnits="userSpaceOnUse">
              <circle cx="3" cy="3" r="1.6" fill={dotColor} />
            </pattern>

            <filter id="tpGeoRingGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="7" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Subtle full-canvas geometric hex lattice */}
          <rect width="1440" height="900" fill="url(#tpGeoHexGrid)" opacity={isDark ? '0.65' : '0.55'} />

          {/* Concentric Luminous Orbital Rings (upper-right geometric focal accent) */}
          <g opacity={isDark ? '0.78' : '0.92'}>
            <circle
              cx="1260"
              cy="40"
              r="320"
              stroke="url(#tpGeoRingGrad)"
              strokeWidth="3.2"
              filter="url(#tpGeoRingGlow)"
            />
            <circle
              cx="1260"
              cy="40"
              r="256"
              stroke={ringStroke}
              strokeWidth="1.5"
              strokeDasharray="10 10"
              opacity="0.72"
            />
            <circle
              cx="1260"
              cy="40"
              r="188"
              stroke="url(#tpGeoRingGrad)"
              strokeWidth="2"
              opacity="0.82"
            />
          </g>

          {/* Translucent Geometric Hexagons (upper-center cluster inspired by reference) */}
          <g>
            <polygon
              points="895,120 936,144 936,192 895,216 854,192 854,144"
              fill={hexFill}
              stroke={hexStroke}
              strokeWidth="1.6"
            />
            <polygon
              points="966,162 1007,186 1007,234 966,258 925,234 925,186"
              fill={hexFill}
              stroke={hexStroke}
              strokeWidth="1.8"
            />
            <polygon
              points="824,162 854,180 854,216 824,234 794,216 794,180"
              fill="none"
              stroke={hexStroke}
              strokeWidth="1.2"
              opacity="0.65"
            />
            <polygon
              points="1335,440 1372,462 1372,506 1335,528 1298,506 1298,462"
              fill={hexFill}
              stroke={hexStroke}
              strokeWidth="1.4"
              opacity="0.78"
            />
          </g>

          {/* Frosted Isometric Glass Tiles (lower-left geometric accent) */}
          <g opacity={isDark ? '0.72' : '0.88'}>
            <rect
              x="255"
              y="775"
              width="110"
              height="68"
              rx="16"
              transform="rotate(24 255 775)"
              fill="url(#tpGeoFacetGrad)"
              stroke={hexStroke}
              strokeWidth="1.6"
            />
            <rect
              x="395"
              y="792"
              width="116"
              height="70"
              rx="16"
              transform="rotate(24 395 792)"
              fill={facetFill}
              stroke={hexStroke}
              strokeWidth="1.5"
            />
          </g>

          {/* Precision Geometric Dot Matrix (bottom-right corner) */}
          <rect x="1180" y="758" width="240" height="126" fill="url(#tpGeoDots)" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none select-none"
      aria-hidden="true"
    >
      {/* Luminous atmospheric pools */}
      <div
        className="tp-wave-a absolute -top-32 -left-24 w-[44rem] h-[44rem] rounded-full opacity-70 blur-3xl"
        style={{
          background: isDark
            ? 'radial-gradient(circle, rgba(124, 58, 237, 0.34) 0%, rgba(79, 70, 229, 0.18) 48%, transparent 74%)'
            : 'radial-gradient(circle, rgba(192, 174, 255, 0.56) 0%, rgba(165, 198, 255, 0.30) 48%, transparent 74%)',
        }}
      />
      <div
        className="tp-wave-b absolute -top-24 -right-28 w-[42rem] h-[42rem] rounded-full opacity-65 blur-3xl"
        style={{
          background: isDark
            ? 'radial-gradient(circle, rgba(59, 130, 246, 0.28) 0%, rgba(124, 58, 237, 0.18) 52%, transparent 74%)'
            : 'radial-gradient(circle, rgba(147, 197, 253, 0.54) 0%, rgba(196, 181, 253, 0.24) 52%, transparent 74%)',
        }}
      />
      <div
        className="tp-wave-a absolute -bottom-36 right-[-6%] w-[48rem] h-[44rem] rounded-full opacity-75 blur-3xl"
        style={{
          background: isDark
            ? 'radial-gradient(circle, rgba(139, 92, 246, 0.34) 0%, rgba(56, 189, 248, 0.16) 48%, transparent 74%)'
            : 'radial-gradient(circle, rgba(167, 139, 250, 0.52) 0%, rgba(125, 211, 252, 0.34) 48%, transparent 74%)',
        }}
      />

      {/* Sculptural 3D Iridescent Liquid Glass Ribbon Waves (Login Page) */}
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full"
        fill="none"
      >
        <defs>
          <linearGradient id="tpLiquidTopLeft" x1="0%" y1="0%" x2="90%" y2="100%">
            <stop offset="0%" stopColor={isDark ? '#6D28D9' : '#E9D5FF'} stopOpacity={isDark ? '0.46' : '0.88'} />
            <stop offset="36%" stopColor={isDark ? '#4F46E5' : '#DDD6FE'} stopOpacity={isDark ? '0.32' : '0.62'} />
            <stop offset="68%" stopColor={isDark ? '#2563EB' : '#BAE6FD'} stopOpacity={isDark ? '0.34' : '0.74'} />
            <stop offset="100%" stopColor={isDark ? '#A78BFA' : '#FFFFFF'} stopOpacity={isDark ? '0.28' : '0.90'} />
          </linearGradient>

          <radialGradient id="tpTopLeftCaustic" cx="38%" cy="76%" r="58%">
            <stop offset="0%" stopColor={isDark ? '#38BDF8' : '#7DD3FC'} stopOpacity={isDark ? '0.30' : '0.72'} />
            <stop offset="45%" stopColor={isDark ? '#8B5CF6' : '#C4B5FD'} stopOpacity={isDark ? '0.22' : '0.34'} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="tpLiquidBottomLeft" x1="0%" y1="10%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={isDark ? '#4C1D95' : '#FFFFFF'} stopOpacity={isDark ? '0.32' : '0.58'} />
            <stop offset="52%" stopColor={isDark ? '#3730A3' : '#DDD6FE'} stopOpacity={isDark ? '0.28' : '0.46'} />
            <stop offset="100%" stopColor={isDark ? '#1E3A8A' : '#C7D2FE'} stopOpacity={isDark ? '0.36' : '0.66'} />
          </linearGradient>

          <linearGradient id="tpLiquidRightBack" x1="15%" y1="100%" x2="95%" y2="8%">
            <stop offset="0%" stopColor={isDark ? '#5B21B6' : '#DDD6FE'} stopOpacity={isDark ? '0.42' : '0.72'} />
            <stop offset="35%" stopColor={isDark ? '#6D28D9' : '#C4B5FD'} stopOpacity={isDark ? '0.34' : '0.56'} />
            <stop offset="65%" stopColor={isDark ? '#3B82F6' : '#93C5FD'} stopOpacity={isDark ? '0.34' : '0.72'} />
            <stop offset="100%" stopColor={isDark ? '#818CF8' : '#E0F2FE'} stopOpacity={isDark ? '0.38' : '0.86'} />
          </linearGradient>

          <radialGradient id="tpRightCrestGlow" cx="55%" cy="46%" r="48%">
            <stop offset="0%" stopColor={isDark ? '#C4B5FD' : '#FFFFFF'} stopOpacity={isDark ? '0.32' : '0.92'} />
            <stop offset="35%" stopColor={isDark ? '#60A5FA' : '#BAE6FD'} stopOpacity={isDark ? '0.24' : '0.62'} />
            <stop offset="72%" stopColor={isDark ? '#7C3AED' : '#C4B5FD'} stopOpacity={isDark ? '0.16' : '0.28'} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="tpLiquidRightFront" x1="10%" y1="92%" x2="92%" y2="18%">
            <stop offset="0%" stopColor={isDark ? '#6D28D9' : '#E9D5FF'} stopOpacity={isDark ? '0.44' : '0.74'} />
            <stop offset="42%" stopColor={isDark ? '#7C3AED' : '#C4B5FD'} stopOpacity={isDark ? '0.48' : '0.82'} />
            <stop offset="74%" stopColor={isDark ? '#4F46E5' : '#BFDBFE'} stopOpacity={isDark ? '0.42' : '0.76'} />
            <stop offset="100%" stopColor={isDark ? '#A78BFA' : '#FFFFFF'} stopOpacity={isDark ? '0.30' : '0.88'} />
          </linearGradient>

          <linearGradient id="tpSpecularRim" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={isDark ? '#DDD6FE' : '#FFFFFF'} stopOpacity={isDark ? '0.46' : '0.98'} />
            <stop offset="45%" stopColor={isDark ? '#A78BFA' : '#F5F3FF'} stopOpacity={isDark ? '0.28' : '0.72'} />
            <stop offset="100%" stopColor={isDark ? '#93C5FD' : '#FFFFFF'} stopOpacity={isDark ? '0.42' : '0.95'} />
          </linearGradient>

          <filter id="tpGlassSoftGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="tp-wave-a">
          <path
            d="M -60 -40 L 470 -40 C 440 70, 355 118, 250 132 C 165 144, 178 265, 118 338 C 68 398, -10 402, -60 370 Z"
            fill="url(#tpLiquidTopLeft)"
          />
          <path
            d="M -40 40 C 80 120, 145 145, 225 130 C 165 162, 168 258, 112 332 C 62 392, -10 398, -50 360 Z"
            fill="url(#tpTopLeftCaustic)"
          />
          <path
            d="M 455 -25 C 425 78, 344 122, 242 135 C 158 146, 174 268, 114 338 C 65 395, -5 400, -55 370"
            stroke="url(#tpSpecularRim)"
            strokeWidth={isDark ? '2.6' : '3.5'}
            strokeLinecap="round"
          />
          <path
            d="M 382 -20 C 345 64, 240 105, 146 150 C 90 176, 52 252, -32 308"
            stroke={isDark ? '#C4B5FD' : '#FFFFFF'}
            strokeOpacity={isDark ? '0.28' : '0.72'}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>

        <g className="tp-wave-b" opacity={isDark ? '0.68' : '0.82'}>
          <path
            d="M -70 500 C 85 510, 215 620, 295 765 C 332 832, 360 885, 380 940 L -70 940 Z"
            fill="url(#tpLiquidBottomLeft)"
          />
          <path
            d="M -60 504 C 86 516, 214 624, 294 768 C 330 834, 358 886, 376 936"
            stroke={isDark ? '#A78BFA' : '#FFFFFF'}
            strokeOpacity={isDark ? '0.32' : '0.78'}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </g>

        <g className="tp-wave-b">
          <path
            d="M 730 940 C 855 835, 995 832, 1088 730 C 1175 634, 1212 435, 1345 344 C 1405 304, 1455 288, 1510 280 L 1510 940 Z"
            fill="url(#tpLiquidRightBack)"
          />
          <path
            d="M 1030 785 C 1125 695, 1178 492, 1308 386 C 1380 328, 1445 316, 1495 318 L 1495 795 Z"
            fill="url(#tpRightCrestGlow)"
            opacity="0.85"
          />
          <path
            d="M 738 936 C 860 834, 998 830, 1090 728 C 1176 632, 1214 434, 1346 344 C 1404 304, 1452 288, 1502 282"
            stroke="url(#tpSpecularRim)"
            strokeWidth={isDark ? '2.6' : '3.5'}
            strokeLinecap="round"
            filter="url(#tpGlassSoftGlow)"
          />
          <path
            d="M 760 945 C 845 868, 960 855, 1055 860 C 1142 864, 1192 752, 1318 712 C 1398 686, 1460 704, 1515 736 L 1515 950 Z"
            fill="url(#tpLiquidRightFront)"
          />
          <path
            d="M 768 940 C 850 868, 962 856, 1056 860 C 1144 864, 1194 752, 1318 712 C 1396 686, 1458 704, 1510 734"
            stroke={isDark ? '#DDD6FE' : '#FFFFFF'}
            strokeOpacity={isDark ? '0.40' : '0.94'}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
}
