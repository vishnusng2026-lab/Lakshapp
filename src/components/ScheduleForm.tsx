import React, { useEffect, useRef, useState } from 'react';
import { Mic, Play, Square, Trash2, X } from 'lucide-react';
import { Freq, Reminder } from '../types/reminder';
import { computeNext, createReminder, Fmt, generateId } from '../lib/reminders';
import { deleteVoiceBlob, getVoiceBlob, saveVoiceBlob } from '../lib/voiceStore';

interface ScheduleFormProps {
  editing: Reminder | null;
  onSave: (reminder: Reminder, wasEdit: boolean) => void;
  onCancel?: () => void;
  onNotice: (message: string) => void;
  compactHeader?: boolean;
}

const WEEKDAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toTimeInputValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export const ScheduleForm: React.FC<ScheduleFormProps> = ({
  editing,
  onSave,
  onCancel,
  onNotice,
  compactHeader = false,
}) => {
  const defaultSoon = () => {
    const d = new Date(Date.now() + 2 * 60_000);
    return {
      hour: d.getHours(),
      minute: d.getMinutes(),
      dateMillis: d.getTime(),
      dow: d.getDay(),
    };
  };

  const initial = defaultSoon();

  const [hour, setHour] = useState<number>(editing?.hour ?? initial.hour);
  const [minute, setMinute] = useState<number>(editing?.minute ?? initial.minute);
  const [caller, setCaller] = useState<string>(editing?.caller ?? '');
  const [task, setTask] = useState<string>(editing?.task ?? '');
  const [freq, setFreq] = useState<Freq>(editing?.freq ?? Freq.ONCE);
  const [dateMillis, setDateMillis] = useState<number>(editing?.dateMillis ?? initial.dateMillis);
  const [dow, setDow] = useState<number>(editing?.dow ?? initial.dow);
  const [speak, setSpeak] = useState<boolean>(editing?.speak ?? true);
  const [voiceId, setVoiceId] = useState<string | null>(editing?.audioId ?? null);

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [playingPreview, setPlayingPreview] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const originalVoiceIdRef = useRef<string | null>(editing?.audioId ?? null);
  const savedRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Sync form state when switching which reminder is being edited
  useEffect(() => {
    const soon = defaultSoon();
    setHour(editing?.hour ?? soon.hour);
    setMinute(editing?.minute ?? soon.minute);
    setCaller(editing?.caller ?? '');
    setTask(editing?.task ?? '');
    setFreq(editing?.freq ?? Freq.ONCE);
    setDateMillis(editing?.dateMillis ?? soon.dateMillis);
    setDow(editing?.dow ?? soon.dow);
    setSpeak(editing?.speak ?? true);
    setVoiceId(editing?.audioId ?? null);
    originalVoiceIdRef.current = editing?.audioId ?? null;
    savedRef.current = false;
    setErrorMsg('');
  }, [editing]);

  // Recording elapsed timer + 60s hard cap (mirrors LaunchedEffect(recording) delay(60_000))
  useEffect(() => {
    if (!recording) {
      setRecordSeconds(0);
      return;
    }
    const interval = window.setInterval(() => {
      setRecordSeconds((prev) => {
        if (prev + 1 >= 60) {
          stopRecording();
          return 60;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [recording]);

  // Clean up mic stream and unsaved voice blobs on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore.
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const stopPreview = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPlayingPreview(false);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const startRecording = async () => {
    stopPreview();
    setErrorMsg('');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onNotice('Microphone recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      if (voiceId && voiceId !== originalVoiceIdRef.current) {
        void deleteVoiceBlob(voiceId);
      }
      setVoiceId(null);

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        if (blob.size > 0) {
          const newId = `voice_${generateId()}`;
          await saveVoiceBlob(newId, blob);
          setVoiceId(newId);
        } else {
          onNotice('Recording failed. Try again.');
        }
      };

      recorder.start();
      setRecording(true);
    } catch {
      onNotice('Microphone permission is needed for voice notes.');
    }
  };

  const handlePlayPreview = async () => {
    if (playingPreview) {
      stopPreview();
      return;
    }
    if (!voiceId) return;
    const blob = await getVoiceBlob(voiceId);
    if (!blob) {
      onNotice('Voice note could not be loaded.');
      return;
    }
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    const audio = new Audio(url);
    previewAudioRef.current = audio;
    audio.onended = () => stopPreview();
    audio.onerror = () => stopPreview();
    setPlayingPreview(true);
    audio.play().catch(() => stopPreview());
  };

  const handleRemoveVoice = () => {
    stopPreview();
    if (voiceId && voiceId !== originalVoiceIdRef.current) {
      void deleteVoiceBlob(voiceId);
    }
    setVoiceId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (recording) stopRecording();
    stopPreview();
    setErrorMsg('');

    const trimmedTask = task.trim();
    if (!trimmedTask) {
      setErrorMsg('Write what the call should remind you about.');
      return;
    }

    const now = Date.now();
    let result: Reminder;
    if (!editing) {
      result = createReminder({
        caller,
        task: trimmedTask,
        hour,
        minute,
        freq,
        dateMillis,
        dow,
        speak,
        audioId: voiceId,
      });
    } else {
      const base: Reminder = {
        ...editing,
        caller: caller.trim() || 'Reminder',
        task: trimmedTask,
        hour,
        minute,
        freq,
        dateMillis,
        dow,
        speak,
        audioId: voiceId,
        completed: false,
        snoozeUntil: 0,
        tries: 0,
        testOnly: false,
      };
      result = {
        ...base,
        nextAt: computeNext(base, now),
      };
    }

    if (result.freq === Freq.ONCE && result.nextAt <= now) {
      setErrorMsg('That time has passed. Pick a later time or date.');
      return;
    }

    if (originalVoiceIdRef.current && originalVoiceIdRef.current !== voiceId) {
      void deleteVoiceBlob(originalVoiceIdRef.current);
    }

    savedRef.current = true;
    onSave(result, Boolean(editing));

    if (!editing) {
      const soon = defaultSoon();
      setHour(soon.hour);
      setMinute(soon.minute);
      setCaller('');
      setTask('');
      setFreq(Freq.ONCE);
      setDateMillis(soon.dateMillis);
      setDow(soon.dow);
      setSpeak(true);
      setVoiceId(null);
      originalVoiceIdRef.current = null;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2
          className={`font-display font-medium tracking-tight text-[#1B1B21] dark:text-[#E4E1E9] ${
            compactHeader ? 'text-2xl' : 'text-[28px]'
          }`}
        >
          {editing ? 'Edit reminder call' : 'New reminder call'}
        </h2>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close form"
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-[#46464F] transition-colors hover:bg-[#E9E7EF] dark:text-[#C5C6D0] dark:hover:bg-[#292A30] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F51A5]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Time row */}
      <div className="flex flex-wrap items-center gap-2.5 text-[15px] text-[#1B1B21] dark:text-[#E4E1E9]">
        <label htmlFor="laksh-time-input" className="text-[#46464F] dark:text-[#C5C6D0]">
          I want a reminder call at
        </label>
        <input
          id="laksh-time-input"
          type="time"
          value={toTimeInputValue(hour, minute)}
          onChange={(e) => {
            const [hStr, mStr] = e.target.value.split(':');
            const h = Number(hStr);
            const m = Number(mStr);
            if (!Number.isNaN(h) && !Number.isNaN(m)) {
              setHour(h);
              setMinute(m);
            }
          }}
          className="font-mono min-h-[44px] cursor-pointer rounded-full border border-[#C6C5D0] bg-white px-4 py-2 text-sm font-medium text-[#3F51A5] tabular-nums transition-colors hover:border-[#3F51A5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F51A5] dark:border-[#46464F] dark:bg-[#1F1F25] dark:text-[#B7C4FF]"
        />
      </div>

      {/* Caller field */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="laksh-caller-input" className="text-[15px] text-[#46464F] dark:text-[#C5C6D0]">
          where
        </label>
        <input
          id="laksh-caller-input"
          type="text"
          maxLength={40}
          value={caller}
          onChange={(e) => setCaller(e.target.value)}
          placeholder="Caller name, like Mom or Doctor"
          className="min-h-[48px] w-full rounded-[20px] border border-[#C6C5D0] bg-white px-4 py-3 text-[15px] text-[#1B1B21] placeholder:text-[#767680] transition-colors focus:border-[#3F51A5] focus:outline-none focus:ring-2 focus:ring-[#3F51A5]/20 dark:border-[#46464F] dark:bg-[#1F1F25] dark:text-[#E4E1E9] dark:placeholder:text-[#8F909A] dark:focus:border-[#B7C4FF]"
        />
      </div>

      {/* Frequency selector */}
      <div className="flex flex-col gap-2">
        <span className="text-[15px] text-[#46464F] dark:text-[#C5C6D0]">will call me</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Call frequency">
          {[
            { value: Freq.ONCE, label: 'Once' },
            { value: Freq.DAILY, label: 'Every day' },
            { value: Freq.WEEKLY, label: 'Every week' },
          ].map((opt) => {
            const active = freq === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setFreq(opt.value)}
                className={`min-h-[44px] cursor-pointer rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F51A5] ${
                  active
                    ? 'bg-[#DDE1FF] text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]'
                    : 'bg-[#EFEDF4] text-[#46464F] hover:bg-[#E3E1EC] dark:bg-[#292A30] dark:text-[#C5C6D0] dark:hover:bg-[#32333B]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conditional Date or Day of week */}
      {freq === Freq.ONCE && (
        <div className="flex flex-wrap items-center gap-2.5 text-[15px]">
          <label htmlFor="laksh-date-input" className="text-[#46464F] dark:text-[#C5C6D0]">
            on
          </label>
          <input
            id="laksh-date-input"
            type="date"
            value={toDateInputValue(dateMillis)}
            onChange={(e) => {
              const parts = e.target.value.split('-').map(Number);
              if (parts.length === 3 && !parts.some(Number.isNaN)) {
                const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
                setDateMillis(d.getTime());
              }
            }}
            className="font-mono min-h-[44px] cursor-pointer rounded-full border border-[#C6C5D0] bg-white px-4 py-2 text-sm font-medium text-[#3F51A5] tabular-nums transition-colors hover:border-[#3F51A5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F51A5] dark:border-[#46464F] dark:bg-[#1F1F25] dark:text-[#B7C4FF]"
          />
          <span className="text-xs text-[#46464F] dark:text-[#C5C6D0]">{Fmt.day(dateMillis)}</span>
        </div>
      )}

      {freq === Freq.WEEKLY && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Day of week">
          {WEEKDAYS.map((d) => {
            const active = dow === d.value;
            return (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDow(d.value)}
                className={`min-h-[40px] min-w-[46px] cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F51A5] ${
                  active
                    ? 'bg-[#DDE1FF] text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]'
                    : 'bg-[#EFEDF4] text-[#46464F] hover:bg-[#E3E1EC] dark:bg-[#292A30] dark:text-[#C5C6D0] dark:hover:bg-[#32333B]'
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Task field */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="laksh-task-input" className="text-[15px] text-[#46464F] dark:text-[#C5C6D0]">
          to remind me about
        </label>
        <textarea
          id="laksh-task-input"
          rows={2}
          maxLength={200}
          value={task}
          onChange={(e) => {
            setTask(e.target.value);
            if (errorMsg) setErrorMsg('');
          }}
          placeholder="Call Mom for her medication"
          className="w-full resize-none rounded-[20px] border border-[#C6C5D0] bg-white px-4 py-3 text-[15px] text-[#1B1B21] placeholder:text-[#767680] transition-colors focus:border-[#3F51A5] focus:outline-none focus:ring-2 focus:ring-[#3F51A5]/20 dark:border-[#46464F] dark:bg-[#1F1F25] dark:text-[#E4E1E9] dark:placeholder:text-[#8F909A] dark:focus:border-[#B7C4FF]"
        />
      </div>

      {/* Voice note recorder */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {recording ? (
            <>
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full bg-[#BA1A1A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#9E1616] dark:bg-[#FFB4AB] dark:text-[#690005]"
              >
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>Stop recording</span>
              </button>
              <span className="font-mono text-xs text-[#46464F] tabular-nums dark:text-[#C5C6D0]">
                Recording… {Fmt.duration(recordSeconds)} / 01:00
              </span>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void startRecording()}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-[#C6C5D0] bg-transparent px-4 py-2 text-sm font-medium text-[#3F51A5] transition-colors hover:bg-[#EFEDF4] dark:border-[#46464F] dark:text-[#B7C4FF] dark:hover:bg-[#292A30]"
              >
                <Mic className="h-4 w-4" aria-hidden="true" />
                <span>{voiceId ? 'Record again' : 'Record voice note'}</span>
              </button>

              {voiceId && (
                <>
                  <button
                    type="button"
                    onClick={() => void handlePlayPreview()}
                    className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full bg-[#EFEDF4] px-3.5 py-2 text-sm font-medium text-[#1B1B21] transition-colors hover:bg-[#E3E1EC] dark:bg-[#292A30] dark:text-[#E4E1E9] dark:hover:bg-[#32333B]"
                  >
                    {playingPreview ? (
                      <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    ) : (
                      <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    )}
                    <span>{playingPreview ? 'Stop' : 'Play'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveVoice}
                    className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-[#BA1A1A] transition-colors hover:bg-[#BA1A1A]/10 dark:text-[#FFB4AB]"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span>Remove note</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
        {voiceId && !recording && (
          <p className="text-xs font-medium text-[#3F51A5] dark:text-[#B7C4FF]">
            Voice note attached. It plays when you answer.
          </p>
        )}
      </div>

      {/* Speak aloud toggle */}
      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-[#1B1B21] select-none dark:text-[#E4E1E9]">
        <input
          type="checkbox"
          checked={speak}
          onChange={(e) => setSpeak(e.target.checked)}
          className="h-5 w-5 rounded border-[#767680] accent-[#3F51A5] dark:accent-[#B7C4FF]"
        />
        <span>Read the task aloud when I answer (if no voice note)</span>
      </label>

      {errorMsg && (
        <p role="alert" className="text-sm font-medium text-[#BA1A1A] dark:text-[#FFB4AB]">
          {errorMsg}
        </p>
      )}

      {/* Primary submit CTA */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          className="min-h-[52px] flex-1 cursor-pointer rounded-full bg-[#3F51A5] px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#354592] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F51A5] focus-visible:ring-offset-2 dark:bg-[#B7C4FF] dark:text-[#0F2072] dark:hover:bg-[#C8D2FF] dark:focus-visible:ring-offset-[#121318]"
        >
          {editing ? 'Save changes' : 'Schedule the call'}
        </button>
        {editing && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[52px] cursor-pointer rounded-full bg-[#EFEDF4] px-5 py-3 text-sm font-medium text-[#46464F] transition-colors hover:bg-[#E3E1EC] dark:bg-[#292A30] dark:text-[#C5C6D0]"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};
