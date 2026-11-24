//! Notification settings: every threshold the producers use, stored as one JSON object in `notifications.config`.
//! Defaults are shared with the app through `tests/fixtures/notification-config-defaults.json`.

use crate::error::{CoreError, Result};
use crate::settings;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const KEY: &str = "notifications.config";
const OLD_HORIZON_KEY: &str = "reminder_horizon_days";

const KINDS: [&str; 13] = [
    "update",
    "billUpcoming",
    "billMissed",
    "priceUp",
    "doubleCharge",
    "largeTransaction",
    "overBudget",
    "monthlyRecap",
    "reviewDigest",
    "moneyIn",
    "possibleDuplicates",
    "statements",
    "moneyTips",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuietHours {
    pub enabled: bool,
    /// "HH:MM", local time.
    pub start: String,
    pub end: String,
}

impl Default for QuietHours {
    fn default() -> Self {
        QuietHours {
            enabled: true,
            start: "22:00".into(),
            end: "08:00".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct KindSwitch {
    pub bell: bool,
    pub banner: bool,
}

impl Default for KindSwitch {
    fn default() -> Self {
        KindSwitch {
            bell: true,
            banner: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub quiet_hours: QuietHours,
    pub kinds: BTreeMap<String, KindSwitch>,
    pub bill_lead_days: i64,
    pub bill_due_day: bool,
    pub missed_grace_days: i64,
    pub price_up_percent: f64,
    pub price_up_min_cents: i64,
    pub double_charge_days: i64,
    pub large_cents: i64,
    pub budget_on_pace: bool,
    pub budget_warn_percent: i64,
    /// 0 = Sunday … 6 = Saturday.
    pub digest_weekday: i64,
    pub digest_min: i64,
    pub money_in_paychecks: bool,
    pub money_in_refunds: bool,
    pub money_in_min_cents: i64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            quiet_hours: QuietHours::default(),
            kinds: KINDS
                .iter()
                .map(|k| (k.to_string(), KindSwitch::default()))
                .collect(),
            bill_lead_days: 3,
            bill_due_day: true,
            missed_grace_days: 3,
            price_up_percent: 2.0,
            price_up_min_cents: 50,
            double_charge_days: 1,
            large_cents: 50_000,
            budget_on_pace: true,
            budget_warn_percent: 100,
            digest_weekday: 1,
            digest_min: 5,
            money_in_paychecks: true,
            money_in_refunds: true,
            money_in_min_cents: 0,
        }
    }
}

impl Config {
    /// Whether a kind goes to the bell at all (a kind switched off there is not produced).
    pub fn bell(&self, kind: &str) -> bool {
        self.kinds.get(kind).is_none_or(|k| k.bell)
    }
}

/// The saved config with defaults for anything missing; the old look-ahead setting seeds the bill lead time.
pub fn load(conn: &Connection) -> Result<Config> {
    let saved = settings::get(conn, KEY)?.and_then(|s| serde_json::from_str::<Config>(&s).ok());
    let mut config = match saved {
        Some(c) => c,
        None => {
            let mut c = Config::default();
            if let Some(days) =
                settings::get(conn, OLD_HORIZON_KEY)?.and_then(|d| d.parse::<i64>().ok())
            {
                c.bill_lead_days = days.clamp(1, 30);
            }
            c
        }
    };
    for k in KINDS {
        config.kinds.entry(k.to_string()).or_default();
    }
    Ok(config)
}

fn hhmm(s: &str) -> bool {
    let Some((h, m)) = s.split_once(':') else {
        return false;
    };
    s.len() == 5
        && matches!((h.parse::<u32>(), m.parse::<u32>()), (Ok(h), Ok(m)) if h < 24 && m < 60)
}

pub fn validate(c: &Config) -> Result<()> {
    let bad = |msg: &str| Err(CoreError::Invalid(msg.into()));
    if !(1..=30).contains(&c.bill_lead_days) {
        return bad("Remind me between 1 and 30 days before a bill.");
    }
    if !(1..=30).contains(&c.missed_grace_days) {
        return bad("The grace period for a missed bill is 1 to 30 days.");
    }
    if !(c.price_up_percent > 0.0 && c.price_up_percent <= 100.0) || c.price_up_min_cents < 0 {
        return bad("A price increase needs a percent above 0 and an amount of 0 or more.");
    }
    if !(1..=7).contains(&c.double_charge_days) {
        return bad("Double charges are looked for within 1 to 7 days.");
    }
    if c.large_cents <= 0 {
        return bad("A large transaction amount must be above $0.");
    }
    if !(50..=200).contains(&c.budget_warn_percent) {
        return bad("Warn between 50% and 200% of a budget.");
    }
    if !(0..=6).contains(&c.digest_weekday) || !(1..=100).contains(&c.digest_min) {
        return bad("The review digest needs a weekday and at least 1 transaction.");
    }
    if c.money_in_min_cents < 0 {
        return bad("The money-in amount can't be negative.");
    }
    if !hhmm(&c.quiet_hours.start) || !hhmm(&c.quiet_hours.end) {
        return bad("Quiet hours need times like 22:00.");
    }
    Ok(())
}

pub fn save(conn: &Connection, c: &Config) -> Result<()> {
    validate(c)?;
    let json = serde_json::to_string(c).map_err(|e| CoreError::Invalid(e.to_string()))?;
    settings::set(conn, KEY, &json)
}
