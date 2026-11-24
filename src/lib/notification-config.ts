// Notification settings (mirrors crates/core/src/notifications/config.rs). Stored as JSON in `notifications.config`.
import type { Ipc } from '@/lib/ipc';
import type { NotificationKind } from '@/lib/types';

export const KEY = 'notifications.config';
export const OLD_HORIZON_KEY = 'reminder_horizon_days';

export const KINDS: NotificationKind[] = ['billMissed', 'billUpcoming', 'doubleCharge', 'largeTransaction', 'moneyIn', 'monthlyRecap', 'overBudget', 'possibleDuplicates', 'priceUp', 'reviewDigest', 'statements', 'update', 'moneyTips'];

export interface QuietHours {
  enabled: boolean;
  start: string; // "HH:MM"
  end: string;
}

export interface NotificationConfig {
  quietHours: QuietHours;
  kinds: Record<NotificationKind, { bell: boolean; banner: boolean }>;
  billLeadDays: number;
  billDueDay: boolean;
  missedGraceDays: number;
  priceUpPercent: number;
  priceUpMinCents: number;
  doubleChargeDays: number;
  largeCents: number;
  budgetOnPace: boolean;
  budgetWarnPercent: number;
  /** 0 = Sunday … 6 = Saturday. */
  digestWeekday: number;
  digestMin: number;
  moneyInPaychecks: boolean;
  moneyInRefunds: boolean;
  moneyInMinCents: number;
}

export const DEFAULT_CONFIG: NotificationConfig = {
  quietHours: { enabled: true, start: '22:00', end: '08:00' },
  kinds: Object.fromEntries(KINDS.map((k) => [k, { bell: true, banner: true }])) as NotificationConfig['kinds'],
  billLeadDays: 3,
  billDueDay: true,
  missedGraceDays: 3,
  priceUpPercent: 2.0,
  priceUpMinCents: 50,
  doubleChargeDays: 1,
  largeCents: 50000,
  budgetOnPace: true,
  budgetWarnPercent: 100,
  digestWeekday: 1,
  digestMin: 5,
  moneyInPaychecks: true,
  moneyInRefunds: true,
  moneyInMinCents: 0,
};

function withDefaults(saved: Partial<NotificationConfig>): NotificationConfig {
  const kinds = { ...DEFAULT_CONFIG.kinds };
  for (const k of KINDS) kinds[k] = { ...DEFAULT_CONFIG.kinds[k], ...(saved.kinds?.[k] ?? {}) };
  return { ...DEFAULT_CONFIG, ...saved, quietHours: { ...DEFAULT_CONFIG.quietHours, ...(saved.quietHours ?? {}) }, kinds };
}

/** The saved config with defaults for anything missing; the old look-ahead seeds the bill lead time. */
export function configFrom(raw: string | null, oldHorizon: string | null): NotificationConfig {
  if (raw) {
    try {
      return withDefaults(JSON.parse(raw) as Partial<NotificationConfig>);
    } catch {
      /* fall through to defaults */
    }
  }
  const days = Number(oldHorizon);
  return days ? { ...withDefaults({}), billLeadDays: Math.min(30, Math.max(1, days)) } : withDefaults({});
}

export async function loadConfig(ipc: Ipc): Promise<NotificationConfig> {
  return configFrom(await ipc.getSetting(KEY), await ipc.getSetting(OLD_HORIZON_KEY));
}

export async function saveConfig(ipc: Ipc, c: NotificationConfig): Promise<void> {
  const errors = validateConfig(c);
  const first = Object.values(errors)[0];
  if (first) throw new Error(first);
  await ipc.setSetting(KEY, JSON.stringify(c));
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Field -> message for every invalid value; empty when all are fine. */
export function validateConfig(c: NotificationConfig): Partial<Record<keyof NotificationConfig, string>> {
  const e: Partial<Record<keyof NotificationConfig, string>> = {};
  const between = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!between(c.billLeadDays, 1, 30)) e.billLeadDays = 'Remind me between 1 and 30 days before a bill.';
  if (!between(c.missedGraceDays, 1, 30)) e.missedGraceDays = 'The grace period is 1 to 30 days.';
  if (!(c.priceUpPercent > 0 && c.priceUpPercent <= 100)) e.priceUpPercent = 'Use a percent above 0 and up to 100.';
  if (!(c.priceUpMinCents >= 0)) e.priceUpMinCents = "The amount can't be negative.";
  if (!between(c.doubleChargeDays, 1, 7)) e.doubleChargeDays = 'Look within 1 to 7 days.';
  if (!(c.largeCents > 0)) e.largeCents = 'Use an amount above $0.';
  if (!between(c.budgetWarnPercent, 50, 200)) e.budgetWarnPercent = 'Warn between 50% and 200% of a budget.';
  if (!between(c.digestWeekday, 0, 6)) e.digestWeekday = 'Pick a day of the week.';
  if (!between(c.digestMin, 1, 100)) e.digestMin = 'Use 1 to 100 transactions.';
  if (!(c.moneyInMinCents >= 0)) e.moneyInMinCents = "The amount can't be negative.";
  if (!HHMM.test(c.quietHours.start) || !HHMM.test(c.quietHours.end)) e.quietHours = 'Quiet hours need times like 22:00.';
  return e;
}

/** Whether `now` (local time) falls in quiet hours; a span like 22:00-08:00 crosses midnight. */
export function inQuietHours(q: QuietHours, now: Date): boolean {
  if (!q.enabled) return false;
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const t = now.getHours() * 60 + now.getMinutes();
  const start = mins(q.start);
  const end = mins(q.end);
  return start <= end ? t >= start && t < end : t >= start || t < end;
}
