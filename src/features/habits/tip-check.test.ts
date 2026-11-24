import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Category, Transaction } from '@/lib/types';
import { DEFAULT_CONFIG, saveConfig } from '@/features/notifications/config';
import { useInboxStore } from '@/features/notifications/inbox-store';
import { useNotificationsStore } from '@/features/notifications/notifications-store';
import { checkTipNews } from './tip-check';
import { SEEN_KEY } from './tip-news';

const cat = (id: number, name: string, extra: Partial<Category> = {}): Category => ({
  id, groupId: 1, name, emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false, ...extra,
});
let nextId = 1;
const tx = (postedOn: string, amountCents: number, categoryId: number, txType: Transaction['txType'] = 'regular'): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: 'X', merchant: 'x', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType,
});

// Six months of $6,200 in, $2,900 rent and $1,800 of wants: shows the 50/30/20 and emergency fund tips.
beforeEach(() => {
  const rows: Transaction[] = [];
  for (let i = 0; i < 6; i++) {
    const m = new Date(Date.UTC(2026, 5 + i, 1)).toISOString().slice(0, 7);
    rows.push(tx(`${m}-01`, 620000, 4, 'income'), tx(`${m}-02`, -290000, 1), tx(`${m}-05`, -180000, 2));
  }
  setIpc(createMemoryIpc({ categories: [cat(1, 'Rent'), cat(2, 'Restaurants'), cat(4, 'Salary', { kind: 'income' })], transactions: rows }));
});

const tipItems = async () => (await ipc().notificationsList(null)).filter((n) => n.kind === 'moneyTips');
const seen = async () => JSON.parse((await ipc().getSetting(SEEN_KEY)) ?? 'null');

describe('checkTipNews', () => {
  it('the first check only remembers the tips showing', async () => {
    await checkTipNews('2026-11-21', null);
    expect(await tipItems()).toEqual([]);
    expect((await seen()).map((s: { id: string }) => s.id).sort()).toEqual(['emergency', 'nospend', 'split']);
  });

  it('adds a bell item per new tip, once', async () => {
    await ipc().setSetting(SEEN_KEY, '[]');
    await checkTipNews('2026-11-21', null);
    const items = await tipItems();
    expect(items.map((n) => n.title).sort()).toEqual(['Close to 50/30/20', 'Emergency fund target: $8,700 to $17,400']);
    expect(items[0].target).toEqual({ kind: 'insights' });
    await checkTipNews('2026-11-21', null);
    expect(await tipItems()).toHaveLength(2);
  });

  it('adds nothing with the Money tips bell off, but still remembers what it saw', async () => {
    await saveConfig(ipc(), { ...DEFAULT_CONFIG, kinds: { ...DEFAULT_CONFIG.kinds, moneyTips: { bell: false, banner: false } } });
    await ipc().setSetting(SEEN_KEY, '[]');
    await checkTipNews('2026-11-21', null);
    expect(await tipItems()).toEqual([]);
    expect(await seen()).toHaveLength(3);
  });

  it('runs with every notification check', async () => {
    useInboxStore.setState({ items: [], open: false });
    useNotificationsStore.getState().configure({ sendBanner: vi.fn(async () => {}), now: () => new Date(2026, 10, 21, 12, 0) });
    useNotificationsStore.setState({ enabled: false, loaded: true });
    await ipc().setSetting('notifications.baselined_at', 'x');
    await ipc().setSetting(SEEN_KEY, '[]');
    await useNotificationsStore.getState().checkNow();
    expect(useInboxStore.getState().items.filter((n) => n.kind === 'moneyTips')).toHaveLength(2);
  });
});
