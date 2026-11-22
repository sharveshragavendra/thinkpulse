import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.tsx';

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

export function ThemeToggle({ compact = false, className = '' }: ThemeToggleProps) {
  const { isDark, toggleTheme } = useTheme();
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={label}
        title={label}
        aria-pressed={isDark}
        className={`w-10 h-10 rounded-full tp-glass-btn flex items-center justify-center text-[#1F1A4A] dark:text-[#EDE9FE] hover:text-[#6D28D9] dark:hover:text-[#C4B5FD] transition-colors shrink-0 cursor-pointer ${className}`}
      >
        {isDark ? (
          <Sun className="w-[18px] h-[18px] text-amber-300" />
        ) : (
          <Moon className="w-[18px] h-[18px] text-[#6D28D9]" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
      className={`tp-glass-btn inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] whitespace-nowrap shrink-0 cursor-pointer ${className}`}
    >
      {isDark ? (
        <>
          <Sun className="w-3.5 h-3.5 text-amber-300 shrink-0" />
          <span>Light Mode</span>
        </>
      ) : (
        <>
          <Moon className="w-3.5 h-3.5 text-[#6D28D9] shrink-0" />
          <span>Dark Mode</span>
        </>
      )}
    </button>
  );
}
