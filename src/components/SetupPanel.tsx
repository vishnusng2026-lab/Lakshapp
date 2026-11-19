import React, { useState } from 'react';
import { Bell, Monitor, Moon, Sun, Volume2, X } from 'lucide-react';
import { ThemeMode } from '../types/reminder';
import { playTestChime, speakTask } from '../lib/ringtone';

interface SetupPanelProps {
  notifPermission: NotificationPermission | 'unsupported';
  onRequestNotif: () => void;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onClose?: () => void;
}

export const SetupPanel: React.FC<SetupPanelProps> = ({
  notifPermission,
  onRequestNotif,
  theme,
  onThemeChange,
  onClose,
}) => {
  const [audioTested, setAudioTested] = useState(false);

  const handleTestSound = () => {
    playTestChime();
    window.setTimeout(() => {
      speakTask('Laksh', 'Your reminder calls are ready to ring.');
    }, 650);
    setAudioTested(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[28px] font-medium tracking-tight text-[#1B1B21] dark:text-[#E4E1E9]">
          Setup
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup"
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-[#46464F] transition-colors hover:bg-[#E9E7EF] dark:text-[#C5C6D0] dark:hover:bg-[#292A30]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Notification status */}
      <div className="rounded-[24px] bg-[#EFEDF4] p-5 dark:bg-[#1F1F25]">
        {notifPermission === 'granted' ? (
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-[#3F51A5] dark:text-[#B7C4FF]">Ready</p>
            <p className="text-sm leading-relaxed text-[#46464F] dark:text-[#C5C6D0]">
              Browser alerts are allowed. Keep this tab open and Laksh will ring full-screen at the scheduled time.
            </p>
          </div>
        ) : notifPermission === 'unsupported' ? (
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-[#1B1B21] dark:text-[#E4E1E9]">
              In-app call alerts active
            </p>
            <p className="text-sm leading-relaxed text-[#46464F] dark:text-[#C5C6D0]">
              This browser does not expose system notifications. Incoming calls still ring full-screen while Laksh is open.
            </p>
          </div>
        ) : notifPermission === 'denied' ? (
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-[#BA1A1A] dark:text-[#FFB4AB]">
              Notifications blocked
            </p>
            <p className="text-sm leading-relaxed text-[#46464F] dark:text-[#C5C6D0]">
              Enable notifications in your browser site settings if you want alerts when this tab is in the background.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-[#1B1B21] dark:text-[#E4E1E9]">
              Laksh can send a browser notification alongside the full-screen incoming call screen.
            </p>
            <div>
              <button
                type="button"
                onClick={onRequestNotif}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full bg-[#3F51A5] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#354592] dark:bg-[#B7C4FF] dark:text-[#0F2072]"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                <span>Allow notifications</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Ringtone & speech audio check */}
      <div className="rounded-[24px] bg-[#EFEDF4] p-5 dark:bg-[#1F1F25]">
        <p className="text-sm font-semibold text-[#1B1B21] dark:text-[#E4E1E9]">
          Sound &amp; voice check
        </p>
        <p className="mt-1 text-sm leading-relaxed text-[#46464F] dark:text-[#C5C6D0]">
          Browsers require a tap to unlock audio. Play a short ringtone and voice preview to verify sound works.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTestSound}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full bg-[#DDE1FF] px-4 py-2 text-sm font-medium text-[#0B1B5E] transition-colors hover:bg-[#CFD5FF] dark:bg-[#2B3A7C] dark:text-[#DDE1FF] dark:hover:bg-[#344691]"
          >
            <Volume2 className="h-4 w-4" aria-hidden="true" />
            <span>Test ringtone &amp; voice</span>
          </button>
          {audioTested && (
            <span className="text-xs font-medium text-[#3F51A5] dark:text-[#B7C4FF]">
              Audio unlocked
            </span>
          )}
        </div>
      </div>

      {/* Appearance */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-[#46464F] dark:text-[#C5C6D0]">Appearance</span>
        <div
          role="radiogroup"
          aria-label="Theme preference"
          className="grid grid-cols-3 gap-1.5 rounded-full bg-[#EFEDF4] p-1.5 dark:bg-[#1F1F25]"
        >
          {(
            [
              { id: 'system', label: 'System', Icon: Monitor },
              { id: 'light', label: 'Light', Icon: Sun },
              { id: 'dark', label: 'Dark', Icon: Moon },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = theme === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onThemeChange(id)}
                className={`inline-flex min-h-[40px] cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#DDE1FF] text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]'
                    : 'text-[#46464F] hover:text-[#1B1B21] dark:text-[#C5C6D0] dark:hover:text-[#E4E1E9]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Privacy & retry rules */}
      <p className="text-xs leading-relaxed text-[#46464F] dark:text-[#C5C6D0]">
        Everything stays on this device in local browser storage. Declined or missed calls ring again after 5 minutes, up to 3 more times.
      </p>
    </div>
  );
};
