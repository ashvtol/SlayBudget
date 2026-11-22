import { describe, expect, it } from 'vitest';
import fixture from '../../../crates/core/tests/fixtures/notification-config-defaults.json';
import { createMemoryIpc } from '@/lib/ipc';
import { DEFAULT_CONFIG, inQuietHours, loadConfig, saveConfig, validateConfig } from './config';

describe('notification config', () => {
  it('has the same defaults as the Rust core', () => {
    expect(DEFAULT_CONFIG).toEqual(fixture);
  });

  it('loads saved values over the defaults, migrating the old look-ahead', async () => {
    const ipc = createMemoryIpc({ settings: { reminder_horizon_days: '14' } });
    expect((await loadConfig(ipc)).billLeadDays).toBe(14);
    await saveConfig(ipc, { ...DEFAULT_CONFIG, largeCents: 120000, billLeadDays: 10 });
    const c = await loadConfig(ipc);
    expect([c.largeCents, c.billLeadDays, c.missedGraceDays]).toEqual([120000, 10, 3]);
  });

  it('explains invalid values per field', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual({});
    const errors = validateConfig({ ...DEFAULT_CONFIG, billLeadDays: 0, largeCents: -5, quietHours: { enabled: true, start: '25:00', end: '08:00' } });
    expect(errors.billLeadDays).toMatch(/days before/);
    expect(errors.largeCents).toBeTruthy();
    expect(errors.quietHours).toBeTruthy();
  });

  it('knows quiet hours, including a span across midnight', () => {
    const q = { enabled: true, start: '22:00', end: '08:00' };
    expect(inQuietHours(q, new Date(2026, 10, 22, 23, 0))).toBe(true);
    expect(inQuietHours(q, new Date(2026, 10, 22, 7, 59))).toBe(true);
    expect(inQuietHours(q, new Date(2026, 10, 22, 8, 0))).toBe(false);
    expect(inQuietHours({ ...q, enabled: false }, new Date(2026, 10, 22, 23, 0))).toBe(false);
    expect(inQuietHours({ enabled: true, start: '13:00', end: '14:00' }, new Date(2026, 10, 22, 13, 30))).toBe(true);
  });
});
