import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { CallOutcome, Reminder } from '../types/reminder';
import { ANSWERED_MAX_MS, Fmt, RING_MS } from '../lib/reminders';
import {
  playVoiceBlob,
  speakTask,
  startRinging,
  stopCallAudio,
  stopRinging,
  unlockAudio,
} from '../lib/ringtone';
import { getVoiceBlob } from '../lib/voiceStore';
import { PhoneGlyph } from './CookieShape';

interface CallScreenProps {
  reminder: Reminder;
  onEnd: (outcome: CallOutcome) => void;
}

export const CallScreen: React.FC<CallScreenProps> = ({ reminder, onEnd }) => {
  const [answered, setAnswered] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioStatus, setAudioStatus] = useState<string>('');
  const endedRef = useRef(false);

  const finishCall = useCallback(
    (outcome: CallOutcome) => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopRinging();
      stopCallAudio();
      onEnd(outcome);
    },
    [onEnd],
  );

  // Ring & auto-miss after 45 seconds (mirrors CallService.RING_MS)
  useEffect(() => {
    endedRef.current = false;
    startRinging();

    const missTimer = window.setTimeout(() => {
      if (!endedRef.current) {
        finishCall('missed');
      }
    }, RING_MS);

    return () => {
      clearTimeout(missTimer);
      stopRinging();
      stopCallAudio();
    };
  }, [reminder.id, finishCall]);

  // Call duration timer and 10-minute max answered timeout (mirrors CallService.ANSWERED_MAX_MS)
  useEffect(() => {
    if (!answered) return;
    const tick = window.setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    const maxTimer = window.setTimeout(() => {
      finishCall('done');
    }, ANSWERED_MAX_MS);

    return () => {
      clearInterval(tick);
      clearTimeout(maxTimer);
    };
  }, [answered, finishCall]);

  const playReminderAudio = useCallback(async () => {
    unlockAudio();
    if (reminder.audioId) {
      const blob = await getVoiceBlob(reminder.audioId);
      if (blob) {
        const played = await playVoiceBlob(blob);
        setAudioStatus(played ? 'Playing your voice note' : 'Voice note ready — tap replay');
        return;
      }
    }
    if (reminder.speak) {
      const spoken = speakTask(reminder.caller, reminder.task);
      setAudioStatus(spoken ? 'Reading task aloud' : '');
    } else {
      setAudioStatus('');
    }
  }, [reminder]);

  const handleAnswer = () => {
    stopRinging();
    setAnswered(true);
    void playReminderAudio();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming reminder call from ${reminder.caller}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-gradient-to-b from-[#0C1118] to-[#16202C] px-6 py-10 text-[#F2F6FB] select-none sm:py-14"
    >
      {/* Top call label */}
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="text-[13px] font-medium tracking-[0.1em] text-[#9FB0C4]">
          {answered ? 'Laksh reminder' : 'Incoming reminder call'}
        </p>
        {reminder.testOnly && (
          <p className="text-xs text-[#7FE0B4]">Test call</p>
        )}
      </div>

      {/* Caller identity & task card */}
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="relative flex items-center justify-center">
          {!answered && (
            <>
              <span
                aria-hidden="true"
                className="animate-ring-pulse absolute h-28 w-28 rounded-full border border-[#7FE0B4]/40"
              />
              <span
                aria-hidden="true"
                className="animate-ring-pulse-delayed absolute h-28 w-28 rounded-full border border-[#7FE0B4]/30"
              />
            </>
          )}
          <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-[#1F2E3D] shadow-xl shadow-black/30">
            <span className="font-display text-[40px] font-bold tracking-tight text-[#7FE0B4]">
              {Fmt.initials(reminder.caller)}
            </span>
          </div>
        </div>

        <h2 className="font-display mt-5 text-[32px] leading-tight font-semibold text-[#F2F6FB] [text-wrap:balance]">
          {reminder.caller}
        </h2>

        <p className="font-mono mt-1.5 text-base text-[#9FB0C4] tabular-nums">
          {answered ? Fmt.duration(seconds) : 'mobile · ringing…'}
        </p>

        {answered && (
          <div className="mt-7 w-full rounded-[18px] bg-[#1B2836] px-5 py-5 text-center shadow-inner">
            <p className="text-[20px] leading-[1.45] font-medium text-[#F2F6FB]">
              {reminder.task}
            </p>
            {(reminder.audioId || reminder.speak) && (
              <div className="mt-4 flex items-center justify-center gap-3">
                {audioStatus && (
                  <span className="text-xs text-[#9FB0C4]">{audioStatus}</span>
                )}
                <button
                  type="button"
                  onClick={() => void playReminderAudio()}
                  className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full bg-[#243547] px-3.5 py-2 text-xs font-medium text-[#DDE8F5] transition-colors hover:bg-[#2E4257] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7FE0B4]"
                >
                  <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Replay audio</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom call controls */}
      <div className="w-full max-w-sm pb-2">
        {!answered ? (
          <div className="flex items-center justify-around">
            <CallActionButton
              label="Decline"
              bgClass="bg-[#D8443A] hover:bg-[#C33B32]"
              onClick={() => finishCall('declined')}
              icon={<PhoneGlyph size={30} className="rotate-[135deg] text-white" />}
            />
            <CallActionButton
              label="Answer"
              bgClass="bg-[#1FA463] hover:bg-[#1B9057]"
              onClick={handleAnswer}
              icon={<PhoneGlyph size={30} className="animate-ring-shake text-white" />}
            />
          </div>
        ) : (
          <div className="flex items-center justify-around">
            <CallActionButton
              label="Snooze 5 min"
              bgClass="bg-[#2C3A4A] hover:bg-[#37485B]"
              onClick={() => finishCall('snooze')}
              icon={<span className="font-mono text-xl font-semibold text-white">+5</span>}
            />
            <CallActionButton
              label="Done"
              bgClass="bg-[#D8443A] hover:bg-[#C33B32]"
              onClick={() => finishCall('done')}
              icon={<PhoneGlyph size={30} className="rotate-[135deg] text-white" />}
            />
          </div>
        )}
      </div>
    </div>
  );
};

interface CallActionButtonProps {
  label: string;
  bgClass: string;
  icon: React.ReactNode;
  onClick: () => void;
}

const CallActionButton: React.FC<CallActionButtonProps> = ({
  label,
  bgClass,
  icon,
  onClick,
}) => (
  <div className="flex flex-col items-center gap-2.5">
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-[72px] w-[72px] cursor-pointer items-center justify-center rounded-full shadow-lg shadow-black/30 transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#16202C] ${bgClass}`}
    >
      {icon}
    </button>
    <span className="text-sm font-medium text-[#CFDAE7] whitespace-nowrap">{label}</span>
  </div>
);
