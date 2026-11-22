import { useEffect, useState, type ReactNode } from 'react';
import { ipc } from '@/lib/ipc';
import { isTauri } from '@/lib/tauri-ipc';
import type { NotificationKind } from '@/lib/types';
import { DEFAULT_CONFIG, loadConfig, saveConfig, validateConfig, type NotificationConfig } from './config';
import { useNotificationsStore } from './notifications-store';
import { isAutostartEnabled, setAutostart } from './notify';
import { Switch } from '@/components/switch';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const muted = { color: 'var(--muted)' };
const field = 'h-[26px] rounded-md border bg-transparent px-2 text-[12px] outline-none';
const fieldStyle = { borderColor: 'var(--line-strong)', color: 'var(--text)' };

const dollars = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
const toCents = (text: string) => {
  const v = Number(text.replace(/[$,\s]/g, ''));
  return text.trim() === '' || !Number.isFinite(v) ? Number.NaN : Math.round(v * 100);
};

type NumberProps = { label: string; value: number; onCommit: (v: number) => void; width?: number; suffix?: string };
/** A number field that saves on blur (or Enter); a new saved value starts it afresh. */
function NumberField(props: NumberProps) {
  return <NumberInput key={props.value} {...props} />;
}
function NumberInput({ label, value, onCommit, width = 52, suffix }: NumberProps) {
  const [text, setText] = useState(String(value));
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(Number(text))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className={field}
        style={{ ...fieldStyle, width }}
      />
      {suffix && <span className="text-[12px]" style={muted}>{suffix}</span>}
    </span>
  );
}

type MoneyProps = { label: string; cents: number; onCommit: (cents: number) => void };
/** A dollar amount field (shown in dollars, saved in cents). */
function MoneyField(props: MoneyProps) {
  return <MoneyInput key={props.cents} {...props} />;
}
function MoneyInput({ label, cents, onCommit }: MoneyProps) {
  const [text, setText] = useState(dollars(cents));
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[12px]" style={muted}>$</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(toCents(text))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className={field}
        style={{ ...fieldStyle, width: 76 }}
      />
    </span>
  );
}

/** An inline option: a small slide toggle with its label after it. */
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <Switch label={label} checked={checked} onChange={onChange} size="sm" labelSide="after" />;
}

/** One kind of notification: name and what it means, its bell and banner switches, and its thresholds. */
function KindRow({ kind, title, hint, config, error, onSwitch, children }: { kind: NotificationKind; title: string; hint: string; config: NotificationConfig; error?: string; onSwitch: (kind: NotificationKind, which: 'bell' | 'banner', v: boolean) => void; children?: ReactNode }) {
  const k = config.kinds[kind];
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-2 py-3" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="flex items-start justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs" style={muted}>{hint}</span>
        </span>
        {/* Bell above Banner; a banner needs the bell, so it's off and disabled while the bell is off. */}
        <span data-stack className="grid shrink-0 grid-cols-[auto_auto] items-center gap-x-2 gap-y-1.5">
          <span className="text-right text-[10px] font-semibold uppercase tracking-[0.06em]" style={muted}>Bell</span>
          <Switch label="Bell" hideLabel size="sm" checked={k.bell} onChange={(v) => onSwitch(kind, 'bell', v)} />
          <span className="text-right text-[10px] font-semibold uppercase tracking-[0.06em]" style={muted}>Banner</span>
          <Switch label="Banner" hideLabel size="sm" checked={k.bell && k.banner} disabled={!k.bell} onChange={(v) => onSwitch(kind, 'banner', v)} />
        </span>
      </div>
      {children && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">{children}</div>}
      {error && (
        <p role="alert" className="m-0 text-[12px]" style={{ color: 'var(--neg)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Settings > Notifications: Mac banners, quiet hours, and each kind's switches and thresholds. */
export function NotificationsPane() {
  const { enabled, load, setEnabled, checkNow, sendTestBanner } = useNotificationsStore();
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof NotificationConfig, string>>>({});
  const [autostart, setAuto] = useState(false);
  const desktop = isTauri();

  useEffect(() => {
    void load();
    void loadConfig(ipc()).then(setConfig);
    void isAutostartEnabled().then(setAuto);
  }, [load]);

  if (!config) return null;

  /** Validate and save; on success re-baseline so only new events notify under the new settings. */
  const update = async (patch: Partial<NotificationConfig>) => {
    const next = { ...config, ...patch };
    const found = validateConfig(next);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setConfig(next);
    await saveConfig(ipc(), next);
    await checkNow({ baseline: true });
  };
  const onSwitch = (kind: NotificationKind, which: 'bell' | 'banner', v: boolean) =>
    void update({ kinds: { ...config.kinds, [kind]: { ...config.kinds[kind], [which]: v } } });
  const errorFor = (...keys: (keyof NotificationConfig)[]) => keys.map((k) => errors[k]).find(Boolean);

  return (
    <section aria-label="Notifications" className="flex flex-col gap-1 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <label className="flex items-center justify-between gap-4 pb-3">
        <span className="flex flex-col">
          <span className="text-sm font-medium">Mac banners</span>
          <span className="text-xs" style={muted}>
            Show alerts in the corner of your screen while SlayBudget is open. The bell in the top bar always keeps them.
          </span>
        </span>
        <Switch label="Mac banners" hideLabel size="md" checked={enabled} onChange={(v) => void setEnabled(v)} />
      </label>
      {desktop && (
        <button type="button" onClick={() => void sendTestBanner()} className="mb-2 self-start text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
          Send a test banner
        </button>
      )}

      <div role="group" aria-label="Quiet hours" className="flex flex-wrap items-center justify-between gap-3 py-3" style={{ borderTop: '1px solid var(--line)' }}>
        <span className="flex flex-col">
          <span className="text-sm font-medium">Quiet hours</span>
          <span className="text-xs" style={muted}>Hold banners overnight; they arrive when quiet hours end.</span>
        </span>
        <span className="flex items-center gap-2 text-[12px]">
          <Check label="On" checked={config.quietHours.enabled} onChange={(v) => void update({ quietHours: { ...config.quietHours, enabled: v } })} />
          <label className="inline-flex items-center gap-1">
            From
            <input aria-label="From" type="time" defaultValue={config.quietHours.start} onBlur={(e) => void update({ quietHours: { ...config.quietHours, start: e.target.value } })} className={field} style={fieldStyle} />
          </label>
          <label className="inline-flex items-center gap-1">
            to
            <input aria-label="To" type="time" defaultValue={config.quietHours.end} onBlur={(e) => void update({ quietHours: { ...config.quietHours, end: e.target.value } })} className={field} style={fieldStyle} />
          </label>
        </span>
        {errors.quietHours && <p role="alert" className="m-0 w-full text-[12px]" style={{ color: 'var(--neg)' }}>{errors.quietHours}</p>}
      </div>

      <KindRow kind="billUpcoming" title="Upcoming bill" hint="A saved recurring bill is coming up." config={config} error={errorFor('billLeadDays')} onSwitch={onSwitch}>
        <span className="inline-flex items-center gap-1.5">Remind me <NumberField label="Days before" value={config.billLeadDays} onCommit={(v) => void update({ billLeadDays: v })} suffix="days before" /></span>
        <Check label="Again on the due day" checked={config.billDueDay} onChange={(v) => void update({ billDueDay: v })} />
      </KindRow>
      <KindRow kind="billMissed" title="Bill looks missed" hint="A bill's due date passed with no charge." config={config} error={errorFor('missedGraceDays')} onSwitch={onSwitch}>
        <span className="inline-flex items-center gap-1.5">After <NumberField label="Grace days" value={config.missedGraceDays} onCommit={(v) => void update({ missedGraceDays: v })} suffix="days" /></span>
      </KindRow>
      <KindRow kind="priceUp" title="Price went up" hint="A bill with a steady price charged more." config={config} error={errorFor('priceUpPercent', 'priceUpMinCents')} onSwitch={onSwitch}>
        <span className="inline-flex items-center gap-1.5">At least <NumberField label="Percent" value={config.priceUpPercent} onCommit={(v) => void update({ priceUpPercent: v })} suffix="%" /></span>
        <span className="inline-flex items-center gap-1.5">and <MoneyField label="Minimum increase" cents={config.priceUpMinCents} onCommit={(v) => void update({ priceUpMinCents: v })} /></span>
      </KindRow>
      <KindRow kind="doubleCharge" title="Possible double charge" hint="The same amount at the same place, twice." config={config} error={errorFor('doubleChargeDays')} onSwitch={onSwitch}>
        <span className="inline-flex items-center gap-1.5">Within <NumberField label="Days apart" value={config.doubleChargeDays} onCommit={(v) => void update({ doubleChargeDays: v })} suffix="days" /></span>
      </KindRow>
      <KindRow kind="largeTransaction" title="Large transaction" hint="A single purchase at or above an amount." config={config} error={errorFor('largeCents')} onSwitch={onSwitch}>
        <span className="inline-flex items-center gap-1.5">At or above <MoneyField label="At or above" cents={config.largeCents} onCommit={(v) => void update({ largeCents: v })} /></span>
      </KindRow>
      <KindRow kind="overBudget" title="Budgets" hint="A category goes over budget, or is on pace to." config={config} error={errorFor('budgetWarnPercent')} onSwitch={onSwitch}>
        <span className="inline-flex items-center gap-1.5">Warn at <NumberField label="Percent of budget" value={config.budgetWarnPercent} onCommit={(v) => void update({ budgetWarnPercent: v })} suffix="% of the budget" /></span>
        <Check label="When on pace to overspend" checked={config.budgetOnPace} onChange={(v) => void update({ budgetOnPace: v })} />
      </KindRow>
      <KindRow kind="monthlyRecap" title="Monthly recap" hint="On the 1st: last month's spending against its budget." config={config} onSwitch={onSwitch} />
      <KindRow kind="reviewDigest" title="Weekly review" hint="Transactions waiting for your review." config={config} error={errorFor('digestWeekday', 'digestMin')} onSwitch={onSwitch}>
        <label className="inline-flex items-center gap-1.5">
          On
          <select aria-label="Day" value={config.digestWeekday} onChange={(e) => void update({ digestWeekday: Number(e.target.value) })} className={field} style={fieldStyle}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        </label>
        <span className="inline-flex items-center gap-1.5">when at least <NumberField label="Minimum to review" value={config.digestMin} onCommit={(v) => void update({ digestMin: v })} suffix="wait" /></span>
      </KindRow>
      <KindRow kind="moneyIn" title="Money in" hint="A paycheck or a refund arrived." config={config} error={errorFor('moneyInMinCents')} onSwitch={onSwitch}>
        <Check label="Paychecks" checked={config.moneyInPaychecks} onChange={(v) => void update({ moneyInPaychecks: v })} />
        <Check label="Refunds" checked={config.moneyInRefunds} onChange={(v) => void update({ moneyInRefunds: v })} />
        <span className="inline-flex items-center gap-1.5">at or above <MoneyField label="Money in minimum" cents={config.moneyInMinCents} onCommit={(v) => void update({ moneyInMinCents: v })} /></span>
      </KindRow>
      <KindRow kind="update" title="Update available" hint="A new version of SlayBudget is ready." config={config} onSwitch={onSwitch} />

      <div className="flex items-center justify-between gap-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
        <button type="button" onClick={() => void update({ ...DEFAULT_CONFIG, quietHours: config.quietHours })} className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
          Restore default thresholds
        </button>
      </div>

      {desktop && (
        <label className="flex items-center justify-between gap-4 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="flex flex-col">
            <span className="text-sm font-medium">Launch at login</span>
            <span className="text-xs" style={muted}>Open SlayBudget automatically when you sign in.</span>
          </span>
          <Switch
            label="Launch at login"
            hideLabel
            size="md"
            checked={autostart}
            onChange={(v) => {
              setAuto(v);
              void setAutostart(v);
            }}
          />
        </label>
      )}
    </section>
  );
}
