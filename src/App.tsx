import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import {
  CallOutcome,
  FilterMode,
  Reminder,
  SortMode,
  ThemeMode,
} from './types/reminder';
import {
  applyOutcomeToReminder,
  dueAt,
  Fmt,
  loadReminders,
  reactivateReminder,
  reconcileStaleReminders,
  saveReminders,
} from './lib/reminders';
import { cleanupOrphanedVoiceBlobs, deleteVoiceBlob } from './lib/voiceStore';
import { unlockAudio } from './lib/ringtone';
import { CookieButton, PhoneGlyph } from './components/CookieShape';
import { ReminderRow } from './components/ReminderRow';
import { ScheduleForm } from './components/ScheduleForm';
import { SetupPanel } from './components/SetupPanel';
import { CallScreen } from './components/CallScreen';

const THEME_KEY = 'laksh_theme_v1';

function getInitialTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Ignore storage read errors.
  }
  return 'system';
}

function getNotifPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

interface ToastState {
  id: number;
  message: string;
  undoReminder?: Reminder;
}

export default function App() {
  const [reminders, setReminders] = useState<Reminder[]>(() => {
    const loaded = loadReminders();
    const reconciled = reconcileStaleReminders(loaded, Date.now());
    if (reconciled !== loaded) {
      saveReminders(reconciled);
    }
    return reconciled;
  });

  const [now, setNow] = useState<number>(() => Date.now());
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('next');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    getNotifPermission,
  );
  const [setupBannerDismissed, setSetupBannerDismissed] = useState(false);

  // Desktop right-side panel mode & mobile sheet visibility
  const [sideTab, setSideTab] = useState<'schedule' | 'setup'>('schedule');
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [mobileSheet, setMobileSheet] = useState<'none' | 'schedule' | 'setup'>('none');

  // Active ringing / answered call
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  // Toast / snackbar with optional Undo delete
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pendingDeleteAudioRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((message: string, undoReminder?: Reminder) => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    // If there was a prior pending audio delete that wasn't undone, flush it now.
    if (pendingDeleteAudioRef.current) {
      const oldId = pendingDeleteAudioRef.current;
      pendingDeleteAudioRef.current = null;
      void deleteVoiceBlob(oldId);
    }
    if (undoReminder?.audioId) {
      pendingDeleteAudioRef.current = undoReminder.audioId;
    }

    const id = Date.now();
    setToast({ id, message, undoReminder });
    toastTimerRef.current = window.setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
      if (pendingDeleteAudioRef.current) {
        const toDelete = pendingDeleteAudioRef.current;
        pendingDeleteAudioRef.current = null;
        void deleteVoiceBlob(toDelete);
      }
    }, undoReminder ? 5500 : 3500);
  }, []);

  // Sync theme to document.documentElement (.dark class)
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore.
    }
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && media.matches);
      root.classList.toggle('dark', isDark);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  // Persist reminders whenever they change
  useEffect(() => {
    saveReminders(reminders);
  }, [reminders]);

  // Clean up orphaned voice note blobs once on startup
  useEffect(() => {
    const activeIds = new Set(
      reminders.map((r) => r.audioId).filter((id): id is string => Boolean(id)),
    );
    void cleanupOrphanedVoiceBlobs(activeIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1-second scheduler & live ETA clock
  useEffect(() => {
    const tick = window.setInterval(() => {
      const current = Date.now();
      setNow(current);

      setReminders((prev) => {
        const dueList = prev.filter((r) => !r.completed && dueAt(r) <= current);
        if (dueList.length === 0) return prev;

        // Pick earliest due call
        dueList.sort((a, b) => dueAt(a) - dueAt(b));
        const firstDue = dueList[0];

        if (activeCallId === null) {
          setActiveCallId(firstDue.id);

          // Optional browser notification when tab is backgrounded
          if (
            typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'granted' &&
            document.hidden
          ) {
            try {
              const n = new Notification(firstDue.caller, {
                body: `Incoming reminder call: ${firstDue.task}`,
                tag: `laksh-call-${firstDue.id}`,
                requireInteraction: true,
              });
              n.onclick = () => {
                window.focus();
                n.close();
              };
            } catch {
              // Ignore notification failures.
            }
          }

          // Postpone any simultaneous second calls by 60s without counting missed
          if (dueList.length > 1) {
            const extras = new Set(dueList.slice(1).map((x) => x.id));
            return prev.map((r) =>
              extras.has(r.id)
                ? { ...r, snoozeUntil: current + 60_000, testOnly: false }
                : r,
            );
          }
          return prev;
        }

        // Already on a call: postpone any other due reminder by 60s
        const others = new Set(
          dueList.filter((x) => x.id !== activeCallId).map((x) => x.id),
        );
        if (others.size === 0) return prev;
        return prev.map((r) =>
          others.has(r.id)
            ? { ...r, snoozeUntil: current + 60_000, testOnly: false }
            : r,
        );
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [activeCallId]);

  const activeCallReminder = useMemo(
    () => (activeCallId ? reminders.find((r) => r.id === activeCallId) ?? null : null),
    [activeCallId, reminders],
  );

  const handleCallEnd = useCallback(
    (outcome: CallOutcome) => {
      if (!activeCallId) return;
      const endedId = activeCallId;
      setActiveCallId(null);
      setReminders((prev) =>
        prev.map((r) =>
          r.id === endedId ? applyOutcomeToReminder(r, outcome, Date.now()) : r,
        ),
      );
      if (outcome === 'snooze') {
        showToast('Snoozed for 5 minutes.');
      } else if (outcome === 'declined') {
        showToast('Call declined.');
      } else if (outcome === 'done') {
        showToast('Reminder marked done.');
      }
    },
    [activeCallId, showToast],
  );

  const handleSaveReminder = useCallback(
    (savedItem: Reminder, wasEdit: boolean) => {
      unlockAudio();
      setReminders((prev) => {
        const idx = prev.findIndex((r) => r.id === savedItem.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = savedItem;
          return copy;
        }
        return [savedItem, ...prev];
      });
      setEditingReminder(null);
      setMobileSheet('none');
      const prefix = wasEdit ? 'Updated.' : 'Scheduled.';
      showToast(`${prefix} ${Fmt.eta(savedItem, Date.now())}.`);
    },
    [showToast],
  );

  const handleTest5s = useCallback(
    (reminder: Reminder) => {
      if (reminder.completed) return;
      unlockAudio();
      const target = Date.now() + 5_000;
      setReminders((prev) =>
        prev.map((r) =>
          r.id === reminder.id
            ? { ...r, snoozeUntil: target, tries: 0, testOnly: true }
            : r,
        ),
      );
      showToast(`Test call from ${reminder.caller} in 5 seconds.`);
    },
    [showToast],
  );

  const handleRingNow = useCallback((reminder: Reminder) => {
    if (reminder.completed) return;
    unlockAudio();
    setReminders((prev) =>
      prev.map((r) =>
        r.id === reminder.id
          ? { ...r, snoozeUntil: Date.now(), tries: 0, testOnly: true }
          : r,
      ),
    );
    setActiveCallId(reminder.id);
  }, []);

  const handleEdit = useCallback((reminder: Reminder) => {
    setEditingReminder(reminder);
    setSideTab('schedule');
    setMobileSheet('schedule');
  }, []);

  const handleReactivate = useCallback(
    (reminder: Reminder) => {
      const next = reactivateReminder(reminder, Date.now());
      setReminders((prev) => prev.map((r) => (r.id === reminder.id ? next : r)));
      showToast(`Reactivated. ${Fmt.eta(next, Date.now())}.`);
    },
    [showToast],
  );

  const handleDelete = useCallback(
    (reminder: Reminder) => {
      setReminders((prev) => prev.filter((r) => r.id !== reminder.id));
      if (editingReminder?.id === reminder.id) {
        setEditingReminder(null);
      }
      showToast('Deleted.', reminder);
    },
    [editingReminder, showToast],
  );

  const handleUndoDelete = useCallback(() => {
    if (!toast?.undoReminder) return;
    const restored = toast.undoReminder;
    if (pendingDeleteAudioRef.current === restored.audioId) {
      pendingDeleteAudioRef.current = null;
    }
    setReminders((prev) => [restored, ...prev]);
    setToast(null);
  }, [toast]);

  const handleRequestNotifications = async () => {
    unlockAudio();
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      if (result === 'granted') {
        showToast('Notifications enabled.');
      }
    } catch {
      // Ignore permission dialog errors.
    }
  };

  const openNewCall = () => {
    setEditingReminder(null);
    setSideTab('schedule');
    setMobileSheet('schedule');
  };

  const openSetup = () => {
    setSideTab('setup');
    setMobileSheet('setup');
  };

  const cycleSort = () => {
    setSort((s) => (s === 'next' ? 'new' : s === 'new' ? 'name' : 'next'));
  };

  const sortLabel =
    sort === 'name'
      ? 'Name A to Z'
      : sort === 'new'
        ? 'Recently added'
        : 'Nearest first';

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reminders
      .filter((r) => {
        if (filter === 'pending') return !r.completed;
        if (filter === 'completed') return r.completed;
        return true;
      })
      .filter(
        (r) =>
          q.length === 0 ||
          `${r.caller} ${r.task}`.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        if (sort === 'name') {
          const byCaller = a.caller.toLowerCase().localeCompare(b.caller.toLowerCase());
          return byCaller !== 0
            ? byCaller
            : a.task.toLowerCase().localeCompare(b.task.toLowerCase());
        }
        if (sort === 'new') {
          return b.created - a.created;
        }
        if (a.completed !== b.completed) {
          return a.completed ? 1 : -1;
        }
        return dueAt(a) - dueAt(b);
      });
  }, [reminders, filter, query, sort]);

  const showSetupBanner = notifPermission === 'default' && !setupBannerDismissed;

  return (
    <div className="min-h-screen bg-[#FBF8FF] text-[#1B1B21] transition-colors dark:bg-[#121318] dark:text-[#E4E1E9]">
      {/* Top Bar — strict 3-zone contract */}
      <header className="sticky top-0 z-30 border-b border-[#E3E1EC]/80 bg-[#FBF8FF]/90 backdrop-blur-md dark:border-[#2A2B33]/80 dark:bg-[#121318]/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Single-line Brand wordmark */}
          <a
            href="#calls"
            onClick={(e) => {
              e.preventDefault();
              setFilter('all');
              setQuery('');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-display text-xl font-bold tracking-tight text-[#1B1B21] whitespace-nowrap shrink-0 dark:text-[#E4E1E9]"
          >
            Laksh
          </a>

          {/* Zone 2: Clean single-line text nav links */}
          <nav
            aria-label="Primary"
            className="hidden items-center gap-6 text-sm font-medium text-[#46464F] md:flex dark:text-[#C5C6D0]"
          >
            {(
              [
                { id: 'all', label: 'All calls' },
                { id: 'pending', label: 'Pending' },
                { id: 'completed', label: 'Completed' },
              ] as const
            ).map((item) => {
              const active = filter === item.id && sideTab === 'schedule';
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setFilter(item.id);
                    setSideTab('schedule');
                  }}
                  className={`cursor-pointer whitespace-nowrap shrink-0 border-b-2 py-1 transition-colors ${
                    active
                      ? 'border-[#3F51A5] text-[#1B1B21] dark:border-[#B7C4FF] dark:text-[#E4E1E9]'
                      : 'border-transparent hover:text-[#1B1B21] dark:hover:text-[#E4E1E9]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={openSetup}
              className={`cursor-pointer whitespace-nowrap shrink-0 border-b-2 py-1 transition-colors ${
                sideTab === 'setup'
                  ? 'border-[#3F51A5] text-[#1B1B21] dark:border-[#B7C4FF] dark:text-[#E4E1E9]'
                  : 'border-transparent hover:text-[#1B1B21] dark:hover:text-[#E4E1E9]'
              }`}
            >
              Setup
            </button>
          </nav>

          {/* Zone 3: Single primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={openNewCall}
              className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full bg-[#3F51A5] px-4 py-2 text-sm font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-[#354592] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F51A5] focus-visible:ring-offset-2 dark:bg-[#B7C4FF] dark:text-[#0F2072] dark:hover:bg-[#C8D2FF] dark:focus-visible:ring-offset-[#121318]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>New call</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main workspace: expands cleanly across 1440px desktop & 375px mobile */}
      <main
        id="calls"
        className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-8 px-4 pt-5 pb-28 sm:px-6 lg:grid-cols-12 lg:pt-8 lg:pb-16"
      >
        {/* Left column: Search, Filters, Your calls list */}
        <section aria-label="Scheduled reminder calls" className="flex flex-col gap-4 lg:col-span-7">
          {/* Search pill with signature 8-lobe Cookie app badge */}
          <div className="flex items-center gap-2 rounded-full bg-[#EFEDF4] p-2 transition-colors focus-within:ring-2 focus-within:ring-[#3F51A5]/40 dark:bg-[#1F1F25] dark:focus-within:ring-[#B7C4FF]/40">
            <CookieButton size={48} variant="primary">
              <PhoneGlyph size={22} />
            </CookieButton>
            <div className="relative flex flex-1 items-center">
              <Search
                className="pointer-events-none mr-2 h-4 w-4 shrink-0 text-[#46464F] dark:text-[#C5C6D0]"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Laksh"
                aria-label="Search reminder calls"
                className="min-h-[44px] w-full bg-transparent pr-3 text-[15px] text-[#1B1B21] placeholder:text-[#767680] focus:outline-none dark:text-[#E4E1E9] dark:placeholder:text-[#8F909A]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#46464F] hover:bg-black/5 dark:text-[#C5C6D0] dark:hover:bg-white/10"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Sort CookieButton + Interactive filter buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <CookieButton
              size={46}
              variant="container"
              onClick={cycleSort}
              title={`Sort: ${sortLabel}`}
              ariaLabel={`Change sort order, currently ${sortLabel}`}
            >
              <span className="text-sm font-bold tracking-tight">A↕</span>
            </CookieButton>

            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter calls">
              {(
                [
                  { key: 'all', label: 'All' },
                  { key: 'pending', label: 'Pending' },
                  { key: 'completed', label: 'Completed' },
                ] as const
              ).map(({ key, label }) => {
                const selected = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setFilter(key)}
                    className={`min-h-[44px] cursor-pointer rounded-full px-5 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3F51A5] ${
                      selected
                        ? 'bg-[#DDE1FF] text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]'
                        : 'bg-[#EFEDF4] text-[#46464F] hover:bg-[#E3E1EC] dark:bg-[#1F1F25] dark:text-[#C5C6D0] dark:hover:bg-[#292A30]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section header */}
          <div className="mt-1 flex items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-[32px] leading-tight font-medium tracking-tight text-[#1B1B21] sm:text-[34px] [text-wrap:balance] dark:text-[#E4E1E9]">
                Your calls
              </h1>
              <p className="mt-0.5 text-[15px] text-[#46464F] tabular-nums dark:text-[#C5C6D0]">
                {filteredRows.length} {filteredRows.length === 1 ? 'call' : 'calls'}
                <span aria-hidden="true"> · </span>
                {sortLabel}
              </p>
            </div>

            <button
              type="button"
              onClick={openNewCall}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-[15px] font-medium text-[#3F51A5] whitespace-nowrap transition-colors hover:bg-[#DDE1FF]/50 lg:hidden dark:text-[#B7C4FF] dark:hover:bg-[#2B3A7C]/40"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>New call</span>
            </button>
          </div>

          {/* Setup banner (mirrors Finish setup card in MainActivity.kt) */}
          {showSetupBanner && (
            <div className="flex items-start justify-between gap-3 rounded-[28px] bg-[#DDE1FF] p-5 text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]">
              <button
                type="button"
                onClick={openSetup}
                className="flex-1 cursor-pointer text-left focus-visible:outline-none"
              >
                <p className="font-display text-[17px] font-semibold">Finish setup</p>
                <p className="mt-0.5 text-sm opacity-90">
                  Allow browser notifications and verify ringtone sound so calls never go unnoticed.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setSetupBannerDismissed(true)}
                aria-label="Dismiss setup prompt"
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Reminder list or empty state */}
          {filteredRows.length === 0 ? (
            <div className="rounded-[28px] bg-[#EFEDF4] px-6 py-8 text-[15px] text-[#46464F] dark:bg-[#1F1F25] dark:text-[#C5C6D0]">
              {reminders.length === 0
                ? 'No calls yet. Tap New call to schedule your first one.'
                : 'No calls match this search or filter.'}
            </div>
          ) : (
            <div className="flex flex-col gap-[3px]">
              {filteredRows.map((r, index) => {
                const position =
                  filteredRows.length === 1
                    ? 'single'
                    : index === 0
                      ? 'first'
                      : index === filteredRows.length - 1
                        ? 'last'
                        : 'middle';

                return (
                  <ReminderRow
                    key={r.id}
                    reminder={r}
                    now={now}
                    position={position}
                    onTest5s={() => handleTest5s(r)}
                    onRingNow={() => handleRingNow(r)}
                    onEdit={() => handleEdit(r)}
                    onReactivate={() => handleReactivate(r)}
                    onDelete={() => handleDelete(r)}
                  />
                );
              })}
            </div>
          )}
        </section>

        {/* Right column (desktop persistent studio panel — prevents desert-island collapse) */}
        <aside
          aria-label="Schedule and setup panel"
          className="hidden lg:sticky lg:top-24 lg:col-span-5 lg:block"
        >
          <div className="rounded-[28px] border border-[#E3E1EC] bg-[#FBF8FF] p-6 dark:border-[#2A2B33] dark:bg-[#191A20]">
            {/* Segmented mode switcher inside side panel */}
            <div
              role="tablist"
              aria-label="Panel view"
              className="mb-6 grid grid-cols-2 gap-1 rounded-full bg-[#EFEDF4] p-1 dark:bg-[#23242B]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === 'schedule'}
                onClick={() => setSideTab('schedule')}
                className={`min-h-[40px] cursor-pointer rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  sideTab === 'schedule'
                    ? 'bg-[#DDE1FF] text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]'
                    : 'text-[#46464F] hover:text-[#1B1B21] dark:text-[#C5C6D0] dark:hover:text-[#E4E1E9]'
                }`}
              >
                {editingReminder ? 'Edit call' : 'New call'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === 'setup'}
                onClick={() => setSideTab('setup')}
                className={`min-h-[40px] cursor-pointer rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  sideTab === 'setup'
                    ? 'bg-[#DDE1FF] text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]'
                    : 'text-[#46464F] hover:text-[#1B1B21] dark:text-[#C5C6D0] dark:hover:text-[#E4E1E9]'
                }`}
              >
                Setup
              </button>
            </div>

            {sideTab === 'schedule' ? (
              <ScheduleForm
                editing={editingReminder}
                compactHeader
                onSave={handleSaveReminder}
                onCancel={editingReminder ? () => setEditingReminder(null) : undefined}
                onNotice={(msg) => showToast(msg)}
              />
            ) : (
              <SetupPanel
                notifPermission={notifPermission}
                onRequestNotif={() => void handleRequestNotifications()}
                theme={theme}
                onThemeChange={setTheme}
              />
            )}
          </div>
        </aside>
      </main>

      {/* Mobile floating pill navigation bar (matches MainActivity.kt, <= 15% sticky height) */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 pointer-events-none lg:hidden"
      >
        <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-[#E9E7EF]/95 p-1.5 shadow-xl shadow-black/15 backdrop-blur-md dark:bg-[#292A30]/95 dark:shadow-black/50">
          <button
            type="button"
            onClick={() => setMobileSheet('none')}
            className={`min-h-[44px] cursor-pointer rounded-full px-5 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
              mobileSheet === 'none'
                ? 'bg-[#DDE1FF] text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]'
                : 'text-[#46464F] dark:text-[#C5C6D0]'
            }`}
          >
            Calls
          </button>
          <button
            type="button"
            onClick={openNewCall}
            className={`min-h-[44px] cursor-pointer rounded-full px-5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              mobileSheet === 'schedule'
                ? 'bg-[#DDE1FF] text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]'
                : 'text-[#46464F] dark:text-[#C5C6D0]'
            }`}
          >
            New call
          </button>
          <button
            type="button"
            onClick={openSetup}
            className={`min-h-[44px] cursor-pointer rounded-full px-5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              mobileSheet === 'setup'
                ? 'bg-[#DDE1FF] text-[#0B1B5E] dark:bg-[#2B3A7C] dark:text-[#DDE1FF]'
                : 'text-[#46464F] dark:text-[#C5C6D0]'
            }`}
          >
            Setup
          </button>
        </div>
      </nav>

      {/* Mobile bottom sheet for Schedule / Edit or Setup */}
      {mobileSheet !== 'none' && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 backdrop-blur-xs lg:hidden"
          onClick={() => {
            setMobileSheet('none');
            setEditingReminder(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-[#FBF8FF] px-5 pt-3 pb-8 shadow-2xl dark:bg-[#121318]"
          >
            <div
              aria-hidden="true"
              className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#C6C5D0] dark:bg-[#46464F]"
            />
            {mobileSheet === 'schedule' ? (
              <ScheduleForm
                editing={editingReminder}
                onSave={handleSaveReminder}
                onCancel={() => {
                  setMobileSheet('none');
                  setEditingReminder(null);
                }}
                onNotice={(msg) => showToast(msg)}
              />
            ) : (
              <SetupPanel
                notifPermission={notifPermission}
                onRequestNotif={() => void handleRequestNotifications()}
                theme={theme}
                onThemeChange={setTheme}
                onClose={() => setMobileSheet('none')}
              />
            )}
          </div>
        </div>
      )}

      {/* Snackbar toast (with Undo on Delete) */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-4 rounded-2xl bg-[#1B1B21] px-4 py-3 text-sm text-[#F2F0F7] shadow-xl lg:bottom-6 dark:bg-[#E4E1E9] dark:text-[#1B1B21]"
        >
          <span>{toast.message}</span>
          {toast.undoReminder && (
            <button
              type="button"
              onClick={handleUndoDelete}
              className="min-h-[36px] shrink-0 cursor-pointer rounded-full px-3 py-1 font-semibold text-[#B7C4FF] hover:bg-white/10 dark:text-[#3F51A5] dark:hover:bg-black/10"
            >
              Undo
            </button>
          )}
        </div>
      )}

      {/* Full-screen incoming reminder call screen */}
      {activeCallReminder && (
        <CallScreen
          reminder={activeCallReminder}
          onEnd={handleCallEnd}
        />
      )}
    </div>
  );
}
