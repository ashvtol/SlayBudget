// What's new in Your money habits since the last check: a tip that wasn't showing (new, or back after you hid it),
// or one that turned into a warning. Turned into bell items, at most 3 before they're grouped into one.

import type { NewNotification } from '@/lib/types';
import { visibleTips, type HiddenTip, type Tip } from './habits-model';

/** What a showing tip looked like at the last check (saved in settings as `tips_seen`). */
export interface SeenTip {
  id: string;
  tone: Tip['tone'];
  value: number;
}

export interface TipNews {
  tip: Tip;
  reason: 'new' | 'back' | 'warn';
}

export const SEEN_KEY = 'tips_seen';
const GROUP_OVER = 3;
/** Changes every day, so it's never news. */
const NEVER = new Set(['nospend']);

/** `previous` null means the first check: remember what's showing and report nothing. */
export function tipNews(previous: SeenTip[] | null, tips: Tip[], hidden: HiddenTip[]): { news: TipNews[]; seen: SeenTip[] } {
  const showing = visibleTips(tips, hidden).shown;
  const seen = showing.map((t) => ({ id: t.id, tone: t.tone, value: t.value }));
  if (previous == null) return { news: [], seen };
  const before = new Map(previous.map((p) => [p.id, p]));
  const wasHidden = new Set(hidden.map((h) => h.id));
  const news: TipNews[] = [];
  for (const t of showing) {
    if (NEVER.has(t.id)) continue;
    const p = before.get(t.id);
    if (!p) news.push({ tip: t, reason: wasHidden.has(t.id) ? 'back' : 'new' });
    else if (p.tone !== 'warn' && t.tone === 'warn') news.push({ tip: t, reason: 'warn' });
  }
  return { news, seen };
}

export function tipNotifications(news: TipNews[], profileId: number | null): NewNotification[] {
  const keyOf = (n: TipNews) => `${n.tip.id}:${n.reason}:${n.tip.value}`;
  if (news.length > GROUP_OVER) {
    return [
      {
        key: `tips:${news.map(keyOf).join('|')}`,
        kind: 'moneyTips',
        title: `${news.length} new money tips`,
        body: `${news.slice(0, 3).map((n) => n.tip.title).join(' · ')} · …`,
        target: { kind: 'insights' },
        profileId,
      },
    ];
  }
  return news.map((n) => ({ key: `tip:${keyOf(n)}`, kind: 'moneyTips', title: n.tip.title, body: n.tip.detail, target: { kind: 'insights' }, profileId }));
}
