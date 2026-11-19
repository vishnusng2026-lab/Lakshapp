import React, { useEffect, useRef, useState } from 'react';
import { Check, MoreVertical } from 'lucide-react';
import { Reminder } from '../types/reminder';
import { Fmt } from '../lib/reminders';
import { CookieButton, PhoneGlyph } from './CookieShape';

interface ReminderRowProps {
  reminder: Reminder;
  now: number;
  position: 'single' | 'first' | 'middle' | 'last';
  onTest5s: () => void;
  onRingNow: () => void;
  onEdit: () => void;
  onReactivate: () => void;
  onDelete: () => void;
}

const RADIUS_BY_POSITION: Record<ReminderRowProps['position'], string> = {
  single: 'rounded-[28px]',
  first: 'rounded-t-[28px] rounded-b-[8px]',
  middle: 'rounded-[8px]',
  last: 'rounded-t-[8px] rounded-b-[28px]',
};

export const ReminderRow: React.FC<ReminderRowProps> = ({
  reminder,
  now,
  position,
  onTest5s,
  onRingNow,
  onEdit,
  onReactivate,
  onDelete,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [menuOpen]);

  return (
    <div
      className={`relative bg-[#EFEDF4] transition-colors hover:bg-[#E9E7EF] dark:bg-[#1F1F25] dark:hover:bg-[#26272F] ${RADIUS_BY_POSITION[position]}`}
    >
      <div className="flex items-center gap-3.5 px-4 py-4 sm:px-5 sm:py-[18px]">
        {/* Initials square tile */}
        <div
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] bg-[#DDE1FF] text-xl font-bold text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]"
        >
          {Fmt.initials(reminder.caller)}
        </div>

        {/* Main details — clean unboxed metadata with typographic separators */}
        <div
          onClick={() => setMenuOpen((o) => !o)}
          className="min-w-0 flex-1 cursor-pointer"
        >
          <div className="flex items-center gap-1.5 text-sm font-medium text-[#3F51A5] dark:text-[#B7C4FF]">
            <PhoneGlyph size={14} />
            <span className="truncate">{Fmt.freq(reminder)}</span>
          </div>

          <p className="mt-0.5 line-clamp-2 text-[18px] leading-snug font-semibold text-[#1B1B21] sm:text-[19px] dark:text-[#E4E1E9]">
            {reminder.task}
          </p>

          <p className="mt-0.5 text-sm text-[#46464F] dark:text-[#C5C6D0]">
            <span>{reminder.caller}</span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono text-[13px] tabular-nums">
              {Fmt.clock(reminder.hour, reminder.minute)}
            </span>
            {reminder.audioId && (
              <>
                <span aria-hidden="true"> · </span>
                <span>voice note</span>
              </>
            )}
          </p>

          <p className="font-mono mt-0.5 text-xs text-[#46464F] tabular-nums dark:text-[#C5C6D0]">
            {reminder.completed ? 'Completed' : Fmt.eta(reminder, now)}
            {reminder.last ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-sans">{reminder.last}</span>
              </>
            ) : null}
          </p>
        </div>

        {/* Right actions: Cookie quick-test / reactivate + overflow menu */}
        <div className="flex shrink-0 items-center gap-1">
          <CookieButton
            size={50}
            variant="container"
            title={reminder.completed ? 'Reactivate call' : 'Test call in 5 seconds'}
            ariaLabel={
              reminder.completed
                ? `Reactivate ${reminder.caller} reminder`
                : `Test call ${reminder.caller} in 5 seconds`
            }
            onClick={(e) => {
              e.stopPropagation();
              if (reminder.completed) onReactivate();
              else onTest5s();
            }}
          >
            {reminder.completed ? (
              <Check className="h-5 w-5 stroke-[2.5]" aria-hidden="true" />
            ) : (
              <PhoneGlyph size={20} />
            )}
          </CookieButton>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label={`More options for ${reminder.task}`}
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
              className="inline-flex h-11 w-9 cursor-pointer items-center justify-center rounded-full text-[#46464F] transition-colors hover:bg-black/5 dark:text-[#C5C6D0] dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F51A5]"
            >
              <MoreVertical className="h-5 w-5" aria-hidden="true" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute top-full right-0 z-30 mt-1 w-52 overflow-hidden rounded-2xl border border-[#E3E1EC] bg-[#FBF8FF] py-1.5 shadow-xl shadow-black/10 dark:border-[#2E2F38] dark:bg-[#292A30] dark:shadow-black/40"
              >
                {!reminder.completed ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onTest5s();
                      }}
                      className="flex min-h-[42px] w-full cursor-pointer items-center px-4 py-2 text-left text-sm text-[#1B1B21] hover:bg-[#EFEDF4] dark:text-[#E4E1E9] dark:hover:bg-[#34353E]"
                    >
                      Test call in 5 seconds
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onRingNow();
                      }}
                      className="flex min-h-[42px] w-full cursor-pointer items-center px-4 py-2 text-left text-sm text-[#1B1B21] hover:bg-[#EFEDF4] dark:text-[#E4E1E9] dark:hover:bg-[#34353E]"
                    >
                      Ring right now
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onReactivate();
                    }}
                    className="flex min-h-[42px] w-full cursor-pointer items-center px-4 py-2 text-left text-sm text-[#1B1B21] hover:bg-[#EFEDF4] dark:text-[#E4E1E9] dark:hover:bg-[#34353E]"
                  >
                    Reactivate
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                  className="flex min-h-[42px] w-full cursor-pointer items-center px-4 py-2 text-left text-sm text-[#1B1B21] hover:bg-[#EFEDF4] dark:text-[#E4E1E9] dark:hover:bg-[#34353E]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className="flex min-h-[42px] w-full cursor-pointer items-center px-4 py-2 text-left text-sm font-medium text-[#BA1A1A] hover:bg-[#BA1A1A]/10 dark:text-[#FFB4AB] dark:hover:bg-[#FFB4AB]/10"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
