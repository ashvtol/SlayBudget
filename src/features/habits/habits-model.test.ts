import { describe, expect, it } from 'vitest';
import type { Category, HabitMonth, HabitsData, Recurring } from '@/lib/types';
import {
  buildTips,
  completeMonths,
  defaultTarget,
  emergencyRange,
  fiAt35,
  fiNumber,
  guiltFree,
  monthlyRates,
  savingsRate,
  splitShares,
  suggestBudget,
  visibleTips,
  yearsToFi,
  type HabitsContext,
} from './habits-model';

// Months ending at the current one (2026-11), oldest first.
function months(n: number, f: (i: number) => Partial<HabitMonth> = () => ({})): HabitMonth[] {
  const out: HabitMonth[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 10 - (n - 1 - i), 1));
    out.push({ month: d.toISOString().slice(0, 7), incomeCents: 620000, spendCents: 470000, essentialCents: 290000, toSavingsCents: 0, ...f(i) });
  }
  return out;
}
const data = (ms: HabitMonth[], extra: Partial<HabitsData> = {}): HabitsData => ({
  firstMonth: ms[0]?.month ?? null, currentMonth: '2026-11', months: ms, flexible: [], daysThisMonth: [], merchants: [], billsRaisedLast12: 0, ...extra,
});
const cat = (id: number, name: string): Category => ({ id, groupId: 1, name, emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false, essential: false });
const categories = [cat(1, 'Restaurants'), cat(2, 'Shopping'), cat(3, 'Delivery')];
const ctx = (d: HabitsData, extra: Partial<HabitsContext> = {}): HabitsContext => ({
  style: 'fire', target: 35, data: d, categories, recurring: [], hasSavings: false, today: '2026-11-23', currency: 'USD', ...extra,
});
/** Flexible spending: each category's monthly amount for the last `n` complete months. */
const flex = (perMonth: Record<number, number>, ms: HabitMonth[], from = 0) =>
  ms.slice(from, -1).flatMap((m) => Object.entries(perMonth).map(([id, cents]) => ({ categoryId: Number(id), month: m.month, cents })));

describe('savings rate', () => {
  it('uses complete months only (not the month in progress)', () => {
    expect(completeMonths(data(months(5))).map((m) => m.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
  });
  it('is income minus spending over income, last 12 complete months, in whole percent', () => {
    expect(savingsRate(completeMonths(data(months(20))))).toBe(24);
  });
  it('needs 3 months with income', () => {
    expect(savingsRate(completeMonths(data(months(3))))).toBeNull(); // only 2 complete
    expect(savingsRate(completeMonths(data(months(4))))).toBe(24);
    expect(savingsRate(completeMonths(data(months(6, () => ({ incomeCents: 0 })))))).toBeNull();
  });
});

describe('months without income (statements from before your checking history)', () => {
  // A year of card spending with no income, then 12 months with income.
  const ms = months(25, (i) => (i < 12 ? { incomeCents: 0, spendCents: 260000, essentialCents: 0 } : {}));
  it('are left out of the savings rate, the averages and the 50/30/20 split', () => {
    const d = data(ms);
    expect(savingsRate(completeMonths(d))).toBe(24);
    expect(splitShares(d)).toEqual({ needs: 47, wants: 29, saved: 24 });
    expect(suggestBudget(ctx(d, { target: 35 }))!.goalSpendCents).toBe(403000);
  });
  it('still show as gaps in the monthly bars', () => {
    const half = months(13, (i) => (i < 6 ? { incomeCents: 0 } : {}));
    expect(monthlyRates(completeMonths(data(half)))).toEqual([null, null, null, null, null, null, 24, 24, 24, 24, 24, 24]);
  });
});

describe('FIRE math', () => {
  it('FI number is 25 times a year of spending; 3.5% is yearly / 0.035', () => {
    expect(fiNumber(5640000)).toBe(141000000);
    expect(fiAt35(5640000)).toBe(161142857);
  });
  it('years to FI from zero at 5% real growth and 4% withdrawal', () => {
    expect(Math.round(yearsToFi(50)!)).toBe(17);
    expect(Math.round(yearsToFi(24)!)).toBe(33);
    expect(yearsToFi(0)).toBeNull();
    expect(yearsToFi(-5)).toBeNull();
    expect(yearsToFi(100)).toBe(0);
  });
  it('default targets: FIRE ten points up to a multiple of 5 (at least 25), Soft at least 20', () => {
    expect(defaultTarget('fire', 24)).toBe(35);
    expect(defaultTarget('fire', 5)).toBe(25);
    expect(defaultTarget('fire', null)).toBe(25);
    expect(defaultTarget('fire', 68)).toBe(70);
    expect(defaultTarget('soft', 24)).toBe(25);
    expect(defaultTarget('soft', 12)).toBe(20);
    expect(defaultTarget('soft', null)).toBe(20);
  });
});

describe('suggested budget', () => {
  const ms = months(25);
  // Last 12 complete months: Restaurants $620, Shopping $540, Delivery $210; the 12 before: $450, $540, $120.
  const flexible = [...flex({ 1: 45000, 2: 54000, 3: 12000 }, ms.slice(0, 13)), ...flex({ 1: 62000, 2: 54000, 3: 21000 }, ms, 12)];
  const d = data(ms, { flexible });

  it('aims at income times (1 - target) and lists flexible categories by size', () => {
    const s = suggestBudget(ctx(d, { target: 35 }))!;
    expect(s.goalSpendCents).toBe(403000);
    expect(s.cutCents).toBe(67000);
    expect(s.rows.map((r) => [r.categoryId, r.avgCents])).toEqual([[1, 62000], [2, 54000], [3, 21000]]);
  });

  it('FIRE spreads the cut in proportion, to the nearest $5', () => {
    const s = suggestBudget(ctx(d, { target: 35 }))!;
    // 67000 of 137000 = 48.9% off each.
    expect(s.rows.map((r) => r.suggestedCents)).toEqual([31500, 27500, 10500]);
    expect(s.reachablePct).toBeNull();
  });

  it('never takes more than half of a category, and says how far halving gets you', () => {
    const s = suggestBudget(ctx(d, { target: 50 }))!;
    expect(s.rows.map((r) => r.suggestedCents)).toEqual([31000, 27000, 10500]);
    expect(s.reachablePct).toBe(35); // (620000 - (470000 - 68500)) / 620000
  });

  it('Soft trims what crept up first, then spreads the rest', () => {
    const s = suggestBudget(ctx(d, { style: 'soft', target: 27 }))!;
    // Goal 452600: cut 17400. Restaurants grew 17000 (crept up), Delivery 9000: 17000 from Restaurants, 400 from Delivery.
    expect(s.rows.map((r) => [r.categoryId, r.suggestedCents, r.creptUp])).toEqual([[1, 45000, true], [2, 54000, false], [3, 20500, true]]);
  });

  it('leaves out categories you unchecked: they keep their average and the cut goes to the rest', () => {
    const s = suggestBudget(ctx(d, { target: 35, choices: { 1: false } }))!;
    expect(s.rows.map((r) => [r.categoryId, r.included, r.suggestedCents])).toEqual([[1, false, 62000], [2, true, 27000], [3, true, 10500]]);
    expect(s.reachablePct).toBe(30); // halving Shopping and Delivery only
  });

  it('starts categories under $20 a month left out, unless you include them', () => {
    const small = data(ms, { flexible: [...flexible, ...flex({ 5: 1500 }, ms, 12)] });
    const withPet = [...categories, cat(5, 'Pet')];
    const s = suggestBudget(ctx(small, { categories: withPet }))!;
    expect(s.rows.find((r) => r.categoryId === 5)).toMatchObject({ included: false, suggestedCents: 1500 });
    const chosen = suggestBudget(ctx(small, { categories: withPet, choices: { 5: true } }))!;
    expect(chosen.rows.find((r) => r.categoryId === 5)!.included).toBe(true);
  });

  it('starts Other (charges still to sort) out of the budget, and drops categories averaging under $1', () => {
    const extra = data(ms, { flexible: [...flexible, ...flex({ 6: 120000, 7: 40 }, ms, 12)] });
    const withOther = [...categories, { ...cat(6, 'Other'), isOther: true }, cat(7, 'Productivity')];
    const s = suggestBudget(ctx(extra, { categories: withOther }))!;
    expect(s.rows.find((r) => r.categoryId === 6)).toMatchObject({ included: false, suggestedCents: 120000 });
    expect(s.rows.some((r) => r.categoryId === 7)).toBe(false);
    expect(suggestBudget(ctx(extra, { categories: withOther, choices: { 6: true } }))!.rows.find((r) => r.categoryId === 6)!.included).toBe(true);
  });

  it('suggests no cut when you already spend less', () => {
    const s = suggestBudget(ctx(d, { target: 20 }))!;
    expect(s.cutCents).toBe(0);
    expect(s.rows.every((r) => r.suggestedCents === r.avgCents)).toBe(true);
  });

  it('is null without income', () => {
    expect(suggestBudget(ctx(data(months(6, () => ({ incomeCents: 0 })))))).toBeNull();
  });
});

describe('other figures', () => {
  it('50/30/20 shares over all complete months', () => {
    expect(splitShares(data(months(4)))).toEqual({ needs: 47, wants: 29, saved: 24 });
    expect(splitShares(data(months(4, () => ({ incomeCents: 0 }))))).toBeNull();
  });
  it('emergency fund: 3 to 6 months of essentials (last 6 complete), to the nearest $100', () => {
    expect(emergencyRange(data(months(10)))).toEqual({ monthlyCents: 290000, lowCents: 870000, highCents: 1740000 });
    expect(emergencyRange(data(months(3)))).toBeNull();
  });
  it('guilt-free: this month’s income minus needs, 20% saving and wants so far', () => {
    const ms = months(4);
    ms[3] = { ...ms[3], incomeCents: 620000, spendCents: 350000, essentialCents: 290000 };
    // 620000 - 290000 - 124000 - 60000
    expect(guiltFree(data(ms))).toBe(146000);
  });
});

describe('tips', () => {
  const ids = (c: HabitsContext) => buildTips(c).map((t) => t.id);

  it('savings rate trend for FIRE with two years of history, never for Soft', () => {
    const ms = months(26, (i) => ({ spendCents: i < 13 ? 533200 : 470000 }));
    const t = buildTips(ctx(data(ms))).find((x) => x.id === 'rate-trend')!;
    expect(t.title).toBe('Your savings rate is up');
    expect(t.detail).toBe('24% saved over the last 12 months, up from 14% the year before. Every extra 10% saved takes roughly 5 to 10 years off the road to independence.');
    expect(t.tone).toBe('good');
    expect(ids(ctx(data(ms), { style: 'soft' }))).not.toContain('rate-trend');
    expect(ids(ctx(data(months(20))))).not.toContain('rate-trend');
  });

  it('50/30/20 with its split', () => {
    const t = buildTips(ctx(data(months(4)))).find((x) => x.id === 'split')!;
    expect(t.title).toBe('Close to 50/30/20');
    expect(t.detail).toBe('Needs, wants and saving in the months your income shows up, against the classic split.');
    expect(t.split).toEqual({ needs: 47, wants: 29, saved: 24 });
    const heavy = buildTips(ctx(data(months(4, () => ({ essentialCents: 400000 }))))).find((x) => x.id === 'split')!;
    expect([heavy.tone, heavy.title]).toEqual(['warn', 'Needs take most of your income']);
  });

  it('emergency fund target', () => {
    const t = buildTips(ctx(data(months(10)))).find((x) => x.id === 'emergency')!;
    expect(t.title).toBe('Emergency fund target: $8,700 to $17,400');
    expect(t.detail).toBe("That's 3 to 6 months of your essentials ($2,900 a month). Keep it in savings, apart from everyday money.");
  });

  it('spending grew faster than income, naming what grew', () => {
    const ms = months(14, (i) => ({ spendCents: i < 7 ? 423000 : 470000, incomeCents: i < 7 ? 600000 : 624000 }));
    const flexible = [...flex({ 1: 45000, 3: 12000 }, ms.slice(0, 8)), ...flex({ 1: 62000, 3: 21000 }, ms, 7)];
    const t = buildTips(ctx(data(ms, { flexible }))).find((x) => x.id === 'creep')!;
    expect(t.tone).toBe('warn');
    expect(t.detail).toBe('Spending is up 11% on the 6 months before, while income is up 4%. Most of it is Restaurants (+38%) and Delivery (+75%).');
    expect(t.link).toBe('categories');
    expect(ids(ctx(data(months(14))))).not.toContain('creep');
  });

  it('subscriptions a year, with bills that went up', () => {
    const recurring = [
      { merchant: 'Netflix', categoryId: null, typicalAmountCents: 1500, cadence: 'monthly', lastDate: '', nextDate: '', occurrences: 3 },
      { merchant: 'Prime', categoryId: null, typicalAmountCents: 13900, cadence: 'yearly', lastDate: '', nextDate: '', occurrences: 2 },
    ] as Recurring[];
    const t = buildTips(ctx(data(months(4), { billsRaisedLast12: 1 }), { recurring })).find((x) => x.id === 'subs')!;
    expect(t.title).toBe('Subscriptions cost $319 a year');
    expect(t.detail).toBe('2 recurring charges, about $27 a month. 1 went up in price in the last year.');
    expect(t.link).toBe('recurring');
  });

  it('leaves bills in essential categories (rent, phone) out of subscriptions', () => {
    const recurring = [
      { merchant: 'Netflix', categoryId: null, typicalAmountCents: 1500, cadence: 'monthly', lastDate: '', nextDate: '', occurrences: 3 },
      { merchant: 'Landlord', categoryId: 9, typicalAmountCents: 220000, cadence: 'monthly', lastDate: '', nextDate: '', occurrences: 3 },
    ] as Recurring[];
    const withRent = [...categories, { ...cat(9, 'Rent'), essential: true }];
    const t = buildTips(ctx(data(months(4)), { recurring, categories: withRent })).find((x) => x.id === 'subs')!;
    expect(t.title).toBe('Subscriptions cost $180 a year');
    expect(t.detail).toBe('1 recurring charge, about $15 a month.');
    const onlyRent = buildTips(ctx(data(months(4)), { recurring: [recurring[1]], categories: withRent }));
    expect(onlyRent.map((x) => x.id)).not.toContain('subs');
  });

  it('small repeat purchases, worded for each style', () => {
    const d = data(months(4), { merchants: [{ name: 'BLUE BOTTLE COFFEE', visits: 160, totalCents: 64000 }] });
    const fire = buildTips(ctx(d)).find((x) => x.id === 'repeat')!;
    expect(fire.title).toBe('Blue Bottle Coffee adds up to $640 a year');
    expect(fire.detail).toBe('160 visits, about $4 each. Halving it would keep about $320 a year.');
    expect(buildTips(ctx(d, { style: 'soft' })).find((x) => x.id === 'repeat')!.detail).toBe("160 visits, about $4 each. If it's a daily joy, keep it.");
    const pricey = data(months(4), { merchants: [{ name: 'Whole Foods', visits: 40, totalCents: 400000 }] });
    expect(ids(ctx(pricey))).not.toContain('repeat');
  });

  it('no-spend days this month', () => {
    const d = data(months(4), { daysThisMonth: [{ day: '2026-11-02', cents: 900 }, { day: '2026-11-03', cents: -200 }, { day: '2026-11-04', cents: 400 }] });
    const t = buildTips(ctx(d, { today: '2026-11-10' })).find((x) => x.id === 'nospend')!;
    expect(t.title).toBe('8 no-spend days this month');
    expect(t.detail).toBe('Days with nothing spent except bills, out of 10 so far.');
    expect(t.tone).toBe('good');
  });

  it('pay yourself first, only with a savings account', () => {
    const ms = months(4);
    ms[3] = { ...ms[3], toSavingsCents: 80000 };
    const t = buildTips(ctx(data(ms), { hasSavings: true })).find((x) => x.id === 'payfirst')!;
    expect(t.title).toBe('$800 moved to savings this month');
    expect(t.detail).toBe("That's 13% of this month's income. Moving it on payday, before spending, makes 35% easier to reach.");
    expect(t.tone).toBe('warn');
    expect(buildTips(ctx(data(ms), { hasSavings: true, style: 'soft' })).find((x) => x.id === 'payfirst')!.tone).toBe('good');
    expect(ids(ctx(data(ms)))).not.toContain('payfirst');
  });

  it('orders warn, then info, then good', () => {
    const ms = months(4, () => ({ essentialCents: 400000 }));
    const tones = buildTips(ctx(data(ms, { daysThisMonth: [] }), { today: '2026-11-10' })).map((t) => t.tone);
    const rank = { warn: 0, info: 1, good: 2 };
    expect(tones).toEqual([...tones].sort((a, b) => rank[a] - rank[b]));
  });

  it('nothing at all without history', () => {
    expect(buildTips(ctx(data([])))).toEqual([]);
  });
});

describe('hidden tips', () => {
  const tip = (id: string, value: number) => ({ id, tone: 'info' as const, title: id, detail: '', value });
  it('stay hidden until the number moves more than 10%', () => {
    const hidden = [{ id: 'subs', hiddenAt: '2026-11-01', value: 374400 }];
    expect(visibleTips([tip('subs', 400000)], hidden).shown).toEqual([]);
    const back = visibleTips([tip('subs', 420000)], hidden);
    expect(back.shown.map((t) => t.id)).toEqual(['subs']);
    expect(back.hidden).toEqual([]);
  });
  it('percent tips come back after 3 points', () => {
    const hidden = [{ id: 'split', hiddenAt: '2026-11-01', value: 24 }];
    expect(visibleTips([tip('split', 26)], hidden).shown).toEqual([]);
    expect(visibleTips([tip('split', 27)], hidden).shown.map((t) => t.id)).toEqual(['split']);
  });
  it('lists the hidden ones that still apply', () => {
    const r = visibleTips([tip('subs', 374400), tip('emergency', 1)], [{ id: 'subs', hiddenAt: '2026-11-01', value: 374400 }, { id: 'gone', hiddenAt: '2026-11-01', value: 1 }]);
    expect(r.shown.map((t) => t.id)).toEqual(['emergency']);
    expect(r.hidden.map((t) => t.id)).toEqual(['subs']);
  });
});
