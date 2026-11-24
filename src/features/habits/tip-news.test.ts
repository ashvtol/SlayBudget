import { describe, expect, it } from 'vitest';
import type { HiddenTip, Tip } from './habits-model';
import { tipNews, tipNotifications, type SeenTip } from './tip-news';

const tip = (id: string, tone: Tip['tone'], value: number, title = `Tip ${id}`): Tip => ({ id, tone, title, detail: `About ${id}.`, value });
const seen = (t: Tip): SeenTip => ({ id: t.id, tone: t.tone, value: t.value });

describe('tipNews', () => {
  it('the first check only remembers what is showing', () => {
    const now = [tip('subs', 'info', 100), tip('split', 'good', 24)];
    const r = tipNews(null, now, []);
    expect(r.news).toEqual([]);
    expect(r.seen).toEqual(now.map(seen));
  });

  it('a tip that was not showing before is new', () => {
    const before = [tip('subs', 'info', 100)];
    const r = tipNews(before.map(seen), [...before, tip('creep', 'warn', 11)], []);
    expect(r.news.map((n) => [n.tip.id, n.reason])).toEqual([['creep', 'new']]);
  });

  it('a hidden tip coming back counts as back', () => {
    const hidden: HiddenTip[] = [{ id: 'subs', hiddenAt: '2026-11-01', value: 100 }];
    // While hidden (unchanged) it isn't showing, so it isn't remembered as seen.
    const quiet = tipNews([], [tip('subs', 'info', 105)], hidden);
    expect(quiet.news).toEqual([]);
    expect(quiet.seen).toEqual([]);
    const back = tipNews(quiet.seen, [tip('subs', 'info', 120)], hidden);
    expect(back.news.map((n) => [n.tip.id, n.reason])).toEqual([['subs', 'back']]);
  });

  it('a tip turning into a warning is news; staying a warning or changing numbers is not', () => {
    const before = [seen(tip('split', 'good', 24))];
    expect(tipNews(before, [tip('split', 'warn', 8)], []).news.map((n) => [n.tip.id, n.reason])).toEqual([['split', 'warn']]);
    expect(tipNews([seen(tip('split', 'warn', 8))], [tip('split', 'warn', 5)], []).news).toEqual([]);
    expect(tipNews([seen(tip('subs', 'info', 100))], [tip('subs', 'info', 900)], []).news).toEqual([]);
  });

  it('never the no-spend days tip, and nothing for a tip that went away', () => {
    expect(tipNews([], [tip('nospend', 'good', 8)], []).news).toEqual([]);
    expect(tipNews([seen(tip('subs', 'info', 100))], [], []).news).toEqual([]);
  });
});

describe('tipNotifications', () => {
  it('one bell item per tip, opening Insights, keyed so the same news is never repeated', () => {
    const news = [{ tip: tip('creep', 'warn', 11, 'Spending grew faster than income'), reason: 'new' as const }];
    expect(tipNotifications(news, null)).toEqual([
      { key: 'tip:creep:new:11', kind: 'moneyTips', title: 'Spending grew faster than income', body: 'About creep.', target: { kind: 'insights' }, profileId: null },
    ]);
  });

  it('more than 3 become one item', () => {
    const news = ['a', 'b', 'c', 'd'].map((id) => ({ tip: tip(id, 'info', 1), reason: 'new' as const }));
    const items = tipNotifications(news, 2);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'moneyTips', title: '4 new money tips', body: 'Tip a · Tip b · Tip c · …', target: { kind: 'insights' }, profileId: 2 });
    expect(items[0].key).toBe('tips:a:new:1|b:new:1|c:new:1|d:new:1');
  });
});
