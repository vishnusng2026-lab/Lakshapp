import { CallOutcome, Freq, Reminder } from '../types/reminder';

const STORAGE_KEY = 'laksh_reminders_v1';
const INIT_KEY = 'laksh_initialized_v1';

export const SNOOZE_MS = 5 * 60_000;
export const STALE_MS = 15 * 60_000;
export const RING_MS = 45_000;
export const ANSWERED_MAX_MS = 10 * 60_000;

export function dueAt(r: Reminder): number {
  return r.snoozeUntil > 0 ? r.snoozeUntil : r.nextAt;
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `laksh-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** First timestamp after `from` that this reminder should ring. */
export function computeNext(
  r: Pick<Reminder, 'hour' | 'minute' | 'freq' | 'dateMillis' | 'dow'>,
  from: number,
): number {
  const at = (baseMs: number, plusDays: number): Date => {
    const d = new Date(baseMs);
    d.setDate(d.getDate() + plusDays);
    d.setHours(r.hour, r.minute, 0, 0);
    return d;
  };

  if (r.freq === Freq.ONCE) {
    return at(r.dateMillis, 0).getTime();
  }

  if (r.freq === Freq.DAILY) {
    const d = at(from, 0);
    if (d.getTime() <= from) {
      d.setDate(d.getDate() + 1);
    }
    return d.getTime();
  }

  // WEEKLY
  let result = from + 7 * 86_400_000;
  for (let i = 0; i <= 7; i++) {
    const d = at(from, i);
    if (d.getDay() === r.dow && d.getTime() > from) {
      result = d.getTime();
      break;
    }
  }
  return result;
}

export function createReminder(params: {
  caller: string;
  task: string;
  hour: number;
  minute: number;
  freq: Freq;
  dateMillis: number;
  dow: number;
  speak: boolean;
  audioId: string | null;
}): Reminder {
  const now = Date.now();
  const base: Reminder = {
    id: generateId(),
    caller: params.caller.trim() || 'Reminder',
    task: params.task.trim(),
    hour: params.hour,
    minute: params.minute,
    freq: params.freq,
    dateMillis: params.dateMillis,
    dow: params.dow,
    speak: params.speak,
    audioId: params.audioId,
    completed: false,
    nextAt: 0,
    snoozeUntil: 0,
    tries: 0,
    last: '',
    created: now,
    testOnly: false,
  };
  return {
    ...base,
    nextAt: computeNext(base, now),
  };
}

export function loadReminders(): Reminder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      if (!localStorage.getItem(INIT_KEY)) {
        const seeded = createStarterReminders();
        saveReminders(seeded);
        localStorage.setItem(INIT_KEY, '1');
        return seeded;
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is Reminder => Boolean(x && typeof x.id === 'string'));
  } catch {
    return [];
  }
}

export function saveReminders(list: Reminder[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    localStorage.setItem(INIT_KEY, '1');
  } catch {
    // Ignore storage quota issues.
  }
}

function createStarterReminders(): Reminder[] {
  const now = new Date();
  const soon = new Date(now.getTime() + 45 * 60_000);
  const evening = new Date(now.getTime());
  evening.setHours(20, 0, 0, 0);
  if (evening.getTime() <= now.getTime()) {
    evening.setDate(evening.getDate() + 1);
  }

  return [
    createReminder({
      caller: 'Mom',
      task: 'Call Mom for her medication',
      hour: evening.getHours(),
      minute: evening.getMinutes(),
      freq: Freq.DAILY,
      dateMillis: evening.getTime(),
      dow: evening.getDay(),
      speak: true,
      audioId: null,
    }),
    createReminder({
      caller: 'Dr. Patel',
      task: 'Confirm dental checkup and bring lab report',
      hour: soon.getHours(),
      minute: soon.getMinutes(),
      freq: Freq.ONCE,
      dateMillis: soon.getTime(),
      dow: soon.getDay(),
      speak: true,
      audioId: null,
    }),
  ];
}

function finishReminder(r: Reminder, note: string, now: number): Reminder {
  const wasRealCall = r.nextAt <= now;
  if (!wasRealCall) {
    return {
      ...r,
      snoozeUntil: 0,
      tries: 0,
      testOnly: false,
      last: note,
    };
  }
  if (r.freq === Freq.ONCE) {
    return {
      ...r,
      completed: true,
      snoozeUntil: 0,
      tries: 0,
      testOnly: false,
      last: note,
    };
  }
  return {
    ...r,
    nextAt: computeNext(r, now),
    snoozeUntil: 0,
    tries: 0,
    testOnly: false,
    last: note,
  };
}

export function applyOutcomeToReminder(
  r: Reminder,
  outcome: CallOutcome,
  now: number = Date.now(),
): Reminder {
  const t = Fmt.time(now);

  if (r.testOnly) {
    const noteMap: Record<CallOutcome, string> = {
      done: `Test answered at ${t}`,
      snooze: `Test snoozed at ${t}`,
      declined: `Test declined at ${t}`,
      expired: `Test expired at ${t}`,
      missed: `Test missed at ${t}`,
    };
    return {
      ...r,
      snoozeUntil: 0,
      tries: 0,
      testOnly: false,
      last: noteMap[outcome],
    };
  }

  if (outcome === 'done') {
    return finishReminder(r, `Answered at ${t}`, now);
  }
  if (outcome === 'snooze') {
    return {
      ...r,
      snoozeUntil: now + SNOOZE_MS,
      testOnly: false,
      last: `Snoozed at ${t}`,
    };
  }
  if (outcome === 'expired') {
    return finishReminder(r, 'Missed while the app was closed', now);
  }

  const tries = r.tries + 1;
  if (tries > 3) {
    return finishReminder(r, 'Missed 3 calls', now);
  }
  return {
    ...r,
    tries,
    snoozeUntil: now + SNOOZE_MS,
    testOnly: false,
    last: outcome === 'declined' ? `Declined at ${t}` : `Missed at ${t}`,
  };
}

export function reconcileStaleReminders(list: Reminder[], now: number = Date.now()): Reminder[] {
  let changed = false;
  const next = list.map((r) => {
    if (r.completed) return r;
    const due = dueAt(r);
    if (due < now - STALE_MS) {
      changed = true;
      return applyOutcomeToReminder(r, 'expired', now);
    }
    if (due < now) {
      changed = true;
      return {
        ...r,
        snoozeUntil: now + 3_000,
        testOnly: false,
      };
    }
    return r;
  });
  return changed ? next : list;
}

export function reactivateReminder(r: Reminder, now: number = Date.now()): Reminder {
  let u: Reminder = {
    ...r,
    completed: false,
    tries: 0,
    snoozeUntil: 0,
    testOnly: false,
    last: '',
    dateMillis: now,
  };
  u = { ...u, nextAt: computeNext(u, now) };
  if (u.nextAt <= now) {
    u = { ...u, dateMillis: now + 86_400_000 };
    u = { ...u, nextAt: computeNext(u, now) };
  }
  return u;
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const Fmt = {
  time(ms: number): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(ms));
  },

  day(ms: number): string {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(ms));
  },

  clock(hour: number, minute: number): string {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return Fmt.time(d.getTime());
  },

  initials(name: string): string {
    const words = name
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    if (words.length === 0) return '?';
    const first = words[0][0].toUpperCase();
    return words.length > 1 ? `${first}${words[words.length - 1][0].toUpperCase()}` : first;
  },

  freq(r: Reminder): string {
    if (r.freq === Freq.ONCE) return Fmt.day(r.dateMillis);
    if (r.freq === Freq.DAILY) return 'Every day';
    return `Every ${DAY_NAMES[r.dow] ?? 'week'}`;
  },

  eta(r: Reminder, now: number): string {
    const due = dueAt(r);
    const diff = due - now;
    if (r.testOnly && diff > 0) {
      const secs = Math.max(1, Math.ceil(diff / 1000));
      return `Test call in ${secs}s`;
    }
    const pre = r.snoozeUntil > 0 ? 'Rings again ' : 'Next call ';
    if (diff <= 0) return 'Ringing now';
    if (diff < 60_000) return `${pre}in under a minute`;
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${pre}in ${mins} min`;
    if (diff < 86_400_000) return `${pre}in ${Math.floor(mins / 60)}h ${mins % 60}m`;
    return `${pre}${Fmt.day(due)}, ${Fmt.time(due)}`;
  },

  duration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },
};
