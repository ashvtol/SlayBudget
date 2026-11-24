// After each notification check: work out today's money tips the way Your money habits does, compare them with the
// last check, and put what's new in the bell (banners follow through the usual delivery).

import { ipc } from '@/lib/ipc';
import { loadConfig } from '@/lib/notification-config';
import { displayCurrency } from '@/features/currency/currency-store';
import { buildTips, completeMonths, defaultTarget, savingsRate, type Style } from './habits-model';
import { KEYS, parseChoices, parseHidden, parseTarget } from './habits-store';
import { SEEN_KEY, tipNews, tipNotifications, type SeenTip } from './tip-news';

function parseSeen(v: string | null): SeenTip[] | null {
  if (v == null) return null;
  try {
    const list = JSON.parse(v);
    return Array.isArray(list) ? list.filter((s) => s && typeof s.id === 'string') : null;
  } catch {
    return null;
  }
}

export async function checkTipNews(today: string, profileId: number | null): Promise<void> {
  const [data, categories, recurring, sources, config, ...settings] = await Promise.all([
    ipc().moneyHabits(profileId, today),
    ipc().listCategories(),
    ipc().analyticsRecurring(profileId, today),
    ipc().listSources(),
    loadConfig(ipc()),
    ...[KEYS.style, KEYS.fire, KEYS.soft, KEYS.hidden, KEYS.choices, SEEN_KEY].map((k) => ipc().getSetting(k)),
  ]);
  const [styleRaw, fire, soft, hiddenRaw, choicesRaw, seenRaw] = settings as (string | null)[];
  const style: Style = styleRaw === 'soft' ? 'soft' : 'fire';
  const target = (style === 'fire' ? parseTarget(fire) : parseTarget(soft)) ?? defaultTarget(style, savingsRate(completeMonths(data)));
  const tips = data.firstMonth
    ? buildTips({
        style,
        target,
        data,
        categories,
        recurring,
        hasSavings: sources.some((s) => s.accountType === 'savings'),
        today,
        currency: displayCurrency(),
        choices: parseChoices(choicesRaw),
      })
    : [];
  const { news, seen } = tipNews(parseSeen(seenRaw), tips, parseHidden(hiddenRaw));
  if (config.kinds.moneyTips?.bell !== false) {
    for (const n of tipNotifications(news, profileId)) await ipc().notificationsAdd(n, false);
  }
  await ipc().setSetting(SEEN_KEY, JSON.stringify(seen));
}
