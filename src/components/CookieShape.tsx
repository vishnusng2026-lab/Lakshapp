import React, { useMemo } from 'react';

function buildCookiePath(size = 100): string {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const steps = 160;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i * 2 * Math.PI) / steps;
    const rr = r * (0.93 + 0.07 * Math.cos(8 * t));
    const x = cx + rr * Math.cos(t);
    const y = cy + rr * Math.sin(t);
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

const COOKIE_PATH = buildCookiePath(100);

interface CookieButtonProps {
  size?: number;
  variant?: 'primary' | 'container' | 'surface';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
}

export const CookieButton: React.FC<CookieButtonProps> = ({
  size = 48,
  variant = 'container',
  onClick,
  title,
  ariaLabel,
  className = '',
  children,
}) => {
  const fillClass = useMemo(() => {
    if (variant === 'primary') {
      return 'fill-[#3F51A5] dark:fill-[#B7C4FF]';
    }
    if (variant === 'surface') {
      return 'fill-[#E9E7EF] dark:fill-[#292A30]';
    }
    return 'fill-[#DDE1FF] dark:fill-[#2B3A7C]';
  }, [variant]);

  const textClass = useMemo(() => {
    if (variant === 'primary') {
      return 'text-white dark:text-[#0F2072]';
    }
    if (variant === 'surface') {
      return 'text-[#1B1B21] dark:text-[#E4E1E9]';
    }
    return 'text-[#0B1B5E] dark:text-[#DDE1FF]';
  }, [variant]);

  const inner = (
    <>
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className={`absolute inset-0 h-full w-full transition-transform duration-150 ${
          onClick ? 'group-hover:scale-[1.04] group-active:scale-95' : ''
        }`}
      >
        <path d={COOKIE_PATH} className={fillClass} />
      </svg>
      <span className={`relative z-10 flex items-center justify-center ${textClass}`}>
        {children}
      </span>
    </>
  );

  const sharedClass = `group relative inline-flex shrink-0 items-center justify-center select-none ${className}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={ariaLabel || title}
        style={{ width: size, height: size }}
        className={`${sharedClass} cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F51A5] focus-visible:ring-offset-2 dark:focus-visible:ring-[#B7C4FF] dark:focus-visible:ring-offset-[#121318]`}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={sharedClass}
    >
      {inner}
    </div>
  );
};

interface PhoneGlyphProps {
  size?: number;
  className?: string;
}

export const PhoneGlyph: React.FC<PhoneGlyphProps> = ({ size = 20, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={`shrink-0 ${className}`}
  >
    <path d="M6.62,10.79c1.44,2.83 3.76,5.14 6.59,6.59l2.2,-2.2c0.27,-0.27 0.67,-0.36 1.02,-0.24 1.12,0.37 2.33,0.57 3.57,0.57 0.55,0 1,0.45 1,1V20c0,0.55 -0.45,1 -1,1 -9.39,0 -17,-7.61 -17,-17 0,-0.55 0.45,-1 1,-1h3.5c0.55,0 1,0.45 1,1 0,1.25 0.2,2.45 0.57,3.57 0.11,0.35 0.03,0.74 -0.25,1.02l-2.2,2.2z" />
  </svg>
);
