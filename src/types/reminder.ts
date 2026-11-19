export enum Freq {
  ONCE = 'ONCE',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
}

export interface Reminder {
  id: string;
  caller: string;
  task: string;
  hour: number;
  minute: number;
  freq: Freq;
  dateMillis: number;
  /** 0 = Sunday .. 6 = Saturday (JS Date.getDay) */
  dow: number;
  speak: boolean;
  audioId: string | null;
  completed: boolean;
  nextAt: number;
  snoozeUntil: number;
  tries: number;
  last: string;
  created: number;
  testOnly: boolean;
}

export type SortMode = 'next' | 'new' | 'name';
export type FilterMode = 'all' | 'pending' | 'completed';
export type CallOutcome = 'done' | 'snooze' | 'declined' | 'missed' | 'expired';
export type ThemeMode = 'system' | 'light' | 'dark';
