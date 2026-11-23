// npm run fx:rates
// Builds crates/core/data/fx-monthly.csv: the European Central Bank's monthly average exchange rates (units of each
// currency per euro) for every currency it still publishes, built into the app so it never goes online for rates.
// Run when cutting a release (npm run release does it).
import { writeFileSync } from 'node:fs';

const URL = 'https://data-api.ecb.europa.eu/service/data/EXR/M..EUR.SP00.A?format=csvdata&detail=dataonly';
const OUT = 'crates/core/data/fx-monthly.csv';

const res = await fetch(URL, { headers: { Accept: 'text/csv' } });
if (!res.ok) throw new Error(`ECB data: ${res.status}`);
const lines = (await res.text()).trim().split(/\r?\n/);
const head = lines[0].split(',');
const [cur, period, value] = ['CURRENCY', 'TIME_PERIOD', 'OBS_VALUE'].map((h) => head.indexOf(h));

const byMonth = new Map<string, Map<string, number>>();
for (const line of lines.slice(1)) {
  const cells = line.split(',');
  const rate = Number(cells[value]);
  if (!(rate > 0)) continue;
  if (!byMonth.has(cells[period])) byMonth.set(cells[period], new Map());
  byMonth.get(cells[period])!.set(cells[cur], rate);
}
const months = [...byMonth.keys()].sort();
// Currencies the ECB still publishes (a rate in the last 12 months); retired ones (drachma, kroon...) are left out.
const recent = months.slice(-12);
const currencies = [...new Set(recent.flatMap((m) => [...byMonth.get(m)!.keys()]))].sort();
const fmt = (n: number) => Number(n.toPrecision(7)).toString();
const rows = months.map((m) => [m, ...currencies.map((c) => (byMonth.get(m)!.has(c) ? fmt(byMonth.get(m)!.get(c)!) : ''))].join(','));
writeFileSync(OUT, `month,${currencies.join(',')}\n${rows.join('\n')}\n`);
console.log(`fx:rates: ${currencies.length} currencies, ${months[0]} to ${months.at(-1)} -> ${OUT}`);
