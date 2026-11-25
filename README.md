<div align="center">

# SlayBudget

### The free, private, local-first budgeting app for Mac

Import your bank statements, let SlayBudget categorize every transaction, and see exactly where your money goes.<br>
**No subscription. No bank login. No cloud.** Your financial data never leaves your Mac.

[![License: MIT](https://img.shields.io/badge/license-MIT-3b82f6.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-111827?logo=apple&logoColor=white)](#install) [![Windows and Linux: untested](https://img.shields.io/badge/Windows%20%7C%20Linux-untested-6b7280)](#windows-and-linux-untested)
[![Built with Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-core-b7410e?logo=rust&logoColor=white)](crates/core)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](src)
[![GitHub stars](https://img.shields.io/github/stars/ashvtol/SlayBudget?style=social)](https://github.com/ashvtol/SlayBudget/stargazers)

**[⬇️ Download for Mac](https://github.com/ashvtol/SlayBudget/releases/latest)** · [Website](https://ashvtol.github.io/SlayBudget/) · [Windows and Linux (untested)](#windows-and-linux-untested)<br><br>[Features](#features) · [Screenshots](#screenshots) · [Why local-first](#why-local-first) · [Install](#install) · [FAQ](#faq) · [Changelog](CHANGELOG.md) · [Contributing](#contributing)

<br>

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/dashboard-light.png">
  <img alt="SlayBudget dashboard: money left to spend this month, transactions to review, net income, upcoming bills, money tips with the savings rate, and top categories against budget" src="docs/screenshots/dashboard.png" width="100%">
</picture>

</div>

---

## Why SlayBudget?

Most budgeting apps want a monthly fee, your bank password and a copy of every transaction on their servers.
SlayBudget gives you the polish of a premium personal finance app as an **open-source, offline Mac app**:

- 💸 **Free forever**: MIT licensed, no trial, no paywall, nothing to cancel.
- 🔒 **Private by design**: one SQLite file on your Mac. No account, no telemetry, no third-party data aggregator.
- ⚡ **Fast and native**: a Rust core and a Tauri app (not Electron). Every screen answers in well under a second.
- 🧠 **Learns how you categorize**: correct a transaction once and the rest of that merchant follows, history
  included. A small classifier on your Mac learns from every choice and says why it picked a category.
- 🔔 **Tells you what matters**: bills coming up or missed, price increases, double charges and budgets running over,
  in an in-app bell and Mac banners that open exactly what they're about.
- 🎨 **Beautiful**: four themes, crisp charts, keyboard shortcuts and accessibility settings.

If you've been looking for a **Copilot Money alternative, a YNAB alternative or a Mint replacement** that keeps your data
on your own computer, this is it.

## Features

| Feature | What it does |
|---|---|
| 📥 **Statement import** | CSV, PDF and QFX/OFX. Built-in layouts for American Express, Citi credit cards and Citi checking, plus a generic CSV importer. Exact repeats are skipped. Drop files in, or let SlayBudget pick up statements from a watched folder or, if you like, your Downloads folder. |
| 🧭 **Statements land in the right account** | SlayBudget works out which account a statement belongs to from the file itself (the account's last 4 digits, the bank, its columns, or the account folder it's in). When it isn't sure, it asks once ("Which account is this?") with its best guess first, and remembers your answer. Drop in 50 statements and it asks once per card, not once per file ("Which account is Chase ending 7781?" for all 12 Chase statements), with **Import all** and **Skip all** for the lot. Two cards from the same bank never get mixed up. Each account can have a default tag (say "Business"), and an import that went to the wrong account can be moved. |
| 🏷️ **Smart categorization** | Learns from every category you choose, on your Mac (nothing is sent anywhere). Change one transaction and the merchant's other ones move too, with **Undo** and **Only this one**. A built-in list of about 900 common merchants helps from day one; cryptic descriptions ("TST* JOES", "SQ *BLUE BTL") are matched by their letters and words. When it's sure it sets the category and says why ("Like 6 others you put in Coffee"); otherwise it suggests one for you to accept, reject or swap for another, alone or all at once. Select several transactions to give them one category together. Money moved between your own accounts (checking to savings, paying the card) is paired and counted as a transfer, not spending. Gas stations and payment apps (Wise, Zelle, PayPal) are only ever suggested, and changing one asks which others with the same name go there too. Your rules and bank categories still apply, and Clean up "Other" works in bulk. |
| 🎯 **Budgets** | Monthly budgets per category or group, per-month overrides, rollovers, and one-click rebalancing. |
| 📊 **Dashboard** | Free to spend this month (with bills set aside), net income, transactions to review, top categories, upcoming bills, and tips with your savings rate against your goal. The spending line turns from green to yellow to orange as you get ahead of your budget's pace; point at any day to see what you'd spent and what the budget allowed by then. |
| 🗂️ **Categories** | 24 months of spending against budget, green within it and orange over. Point at a month to see it, click to open it, then open and edit any transaction in place. |
| 💵 **Cash flow** | Income, spending and net for this month, the last 4 weeks, 3 or 12 months, or year to date, compared with the previous period or year. Move across a chart and the card shows that month against the same month last year; Spend lists that month's categories. In the details, click any month of the last two years to see each category with its top merchants, or each income source with who paid it, and choose which categories count. |
| 🔁 **Recurring bills and subscriptions** | Detected automatically, with due dates, reminders, amount ranges and pause or archive. Bills can repeat weekly up to every 4 years, for subscriptions bought 2, 3 or 4 years at a time. When a subscription changes price (up or down), SlayBudget asks once, "Is this Equinox at a new price?", and the bill follows the new price with a price history. Two bills that look like the same subscription are suggested for merging, including one whose statement name changed (HBO Max, then Max), with an ⓘ to compare them side by side. A bill that's paid back by a card's statement credit (Walmart+ refunded by Amex, say) shows each charge with its credit, "Fully credited" or "Partly credited", and what it actually cost you; SlayBudget finds those credits and asks "Do they pay it back?", even when one credit is shared by several bills. Charges join their bill even off the usual day, a price drop or rise shows an arrow, payment apps (Venmo, Zelle) match the person paid, and a bill follows its charges' category. |
| 🗺️ **Insights** | An interactive spending map for any time range: drill from category to merchant and see what grew. Below it, Your money habits looks at all your history (see the next row). |
| 🔥 **Your money habits** | Pick a money style, **FIRE** (Financial Independence, Retire Early) or **Soft saving**, and see your savings rate, your FI number (25 times a year of spending) and roughly how many years to independence, worked out from all your history. A suggested budget, next to the budgets you have now (↓ lower, ↑ raise), trims flexible spending toward a savings target you choose (needs and bills stay as they are, and you can leave any category out, or all of them, with the header checkbox); apply it in one click and ⌘Z takes it back. Tips cover the 50/30/20 split, an emergency fund target, spending that grew faster than income, what subscriptions cost a year, small purchases that add up, no-spend days and paying yourself first. Hide any tip; it comes back if its numbers change a lot. Mark categories as Essential to tell needs from wants. Rules of thumb, not financial advice. |
| ↔️ **Resizable panes** | Drag the line between a list and its detail to make either side wider (Transactions, Categories, Recurrings). SlayBudget remembers it per page; double-click puts it back. |
| 🔎 **Transactions** | Instant search, filters (category, tag, account, type, amount, date), splits, refunds, notes, tags, transfers and the original statement details. |
| 👯 **Possible duplicates** | Overlapping statements (a mid-month download, then the full statement; or the CSV, then the PDF) can carry the same purchase in a slightly different form. SlayBudget flags those on import: the same charge worded differently, a tip added after the fact, a card hold replaced by the final charge, or a pending charge that posted days later. Each one gets an amber "Possible duplicate" tag and a plain explanation. Delete either one, or mark it "Not a duplicate" and it never comes back. Nothing is ever removed for you. |
| 💱 **Your currency, offline** | Show every amount in your currency (30+ to choose from): transactions, totals, budgets, charts and bills, each converted at its own month's rate. The European Central Bank's rates are built into the app, so nothing goes online to convert, and your data keeps its original currency. Changing numbers roll like a ticker. |
| ↩️ **Undo and redo** | ⌘Z takes back your last change and ⇧⌘Z puts it back, 15 steps deep, like any Mac app: a category (and the history that moved with it), a delete (with its splits and tags), a budget, an import. The Edit menu names the step ("Undo Change Category"). |
| 🗑️ **Delete and undo imports** | Delete any transactions (one or many), or undo a whole import from Recent imports. Both ask first and back up your data before changing anything. |
| 🔔 **Notifications** | A bell in every screen's top bar, plus Mac banners: upcoming and missed bills, subscription price changes, possible double charges, large transactions, budgets over or on pace to overspend, a monthly recap, a weekly review reminder, paychecks or refunds arriving, and new money tips. Click one to jump straight to it. Quiet hours, and every threshold is yours to tune. |
| ⬆️ **Automatic updates** | Signed updates from GitHub. SlayBudget shows what's new since your version and installs only when you click. |
| 👨‍👩‍👧 **Profiles** | Keep household members' accounts separate, or view everything combined. |
| 🛡️ **Your data, your rules** | One-click database backup, and a rules export that leaves out anything identifying you. |
| ♿ **Accessible** | Light, dark and system themes, reduced motion, signed amounts and full keyboard navigation. |

## Screenshots

> Every screenshot uses the built-in sample data. No real financial data is shown.

### Transactions: search, review and edit in one place
![SlayBudget transactions list with category pills, review dots and a transaction detail pane showing category, account, type, notes, tags and statement details](docs/screenshots/transactions.png)

### Categories: budgets against 24 months of history
![SlayBudget categories view with spend against budget per category and a 24-month budget history chart](docs/screenshots/categories.png)

### Edit any transaction without leaving the page
![SlayBudget category detail with a side pane for editing a restaurant transaction](docs/screenshots/transaction-pane.png)

<table>
<tr>
<td width="50%">

**Notifications: the bell**
![SlayBudget notification bell listing an update, a missed bill, transactions to review, budgets over and a paycheck](docs/screenshots/notifications.png)

</td>
<td width="50%">

**Tune every alert**
![SlayBudget notification settings with macOS-style toggles for the bell and Mac banners, quiet hours and thresholds](docs/screenshots/notification-settings.png)

</td>
</tr>
<tr>
<td width="50%">

**Cash flow**
![SlayBudget cash flow with net income, spending and income charts by month](docs/screenshots/cash-flow.png)

</td>
<td width="50%">

**Recurring bills and subscriptions**
![SlayBudget recurring bills with this month's payments, rules and payment history](docs/screenshots/recurrings.png)

</td>
</tr>
<tr>
<td width="50%">

**Insights: where your money went**
![SlayBudget spending map treemap by category and merchant with insights](docs/screenshots/insights.png)

</td>
<td width="50%">

**Daylight theme**
![SlayBudget categories view in the light theme](docs/screenshots/categories-light.png)

</td>
</tr>
</table>

<table>
<tr>
<td width="50%">

**Possible duplicates: why, and what to do**
![SlayBudget transaction detail with an amber Possible duplicate box explaining it matches another charge on the same day, with Delete this one, Delete the other one and Not a duplicate](docs/screenshots/possible-duplicate.png)

</td>
<td width="50%">

**Recent imports, each one undoable**
![SlayBudget import page listing recent statement imports with the account, date, rows added and an Undo button](docs/screenshots/recent-imports.png)

</td>
</tr>
</table>

### A subscription changed price? Asked once
![SlayBudget Recurrings page with Equinox selected, asking "Is this Equinox at a new price? It was $55.00, this is $89.00 (+62%)" with Yes, new price, No, a one-off and A separate subscription](docs/screenshots/price-change.png)

### Subscriptions paid back by a card credit
![SlayBudget Recurrings page with Walmart+ selected: Fully credited, a Paid back by Amex Walmart+ Credit rule, Key metrics with Credited and Cost you columns at $0.00, and each charge followed by its credit two days later](docs/screenshots/paid-back.png)

**SlayBudget finds the credits and asks first; the ⓘ shows each charge beside its credit**
![SlayBudget asking "Credits from Amex Walmart+ Credit match 14 Walmart+ charges. Do they pay it back?" with the matching charges and credits listed by date, each marked Full](docs/screenshots/paid-back-ask.png)

### A subscription renamed on your statement? Suggested for merging
![SlayBudget suggesting "HBO Max and Max look like the same subscription. Merge them?" with the two bills compared side by side: the same amount, frequency, due day and category, one ending in May and the other starting after](docs/screenshots/renamed-merge.png)

### Your money habits: FIRE or Soft saving, a suggested budget and tips
![SlayBudget Insights showing Your money habits: the FIRE style with a 50% savings rate, an FI number and about 17 years to independence, a suggested budget trimming flexible categories toward a 60% target, and tips about an emergency fund, subscriptions, a coffee habit and no-spend days](docs/screenshots/money-habits.png)

### Suggested categories: why, and one click to accept
![SlayBudget Transactions filtered to Suggested category, with Accept all, and a Marinara Pizza charge that needs a category showing the suggestion Restaurants, "Like 40 others you put in Restaurants", with Reject and Accept](docs/screenshots/suggested-categories.png)

### Which account is this? Asked once, then remembered
![SlayBudget import page asking which account a Chase statement belongs to, showing its dates, first transactions and Chase ending 7781, with existing accounts or a new account with bank, type and default tag](docs/screenshots/which-account.png)

### Four themes: Navy, Daylight, Aurora and Graphite
![SlayBudget dashboard in the Navy, Daylight, Aurora and Graphite themes](docs/screenshots/themes.png)

## Why local-first?

| | SlayBudget | Typical budgeting apps |
|---|:---:|:---:|
| Price | **Free (MIT)** | Paid subscription |
| Where your transactions live | **On your Mac** | Their cloud |
| Needs your bank login | **No**: you import statements | Usually, through an aggregator |
| Works offline | **Yes** | No |
| Open source | **Yes** | No |
| Export and back up everything | **One click** | Varies |

SlayBudget reads the statements you download yourself and never sends them anywhere. You own the data, it works on a
plane, and there's nothing to cancel.

## Install

**[⬇️ Download the latest SlayBudget for Mac](https://github.com/ashvtol/SlayBudget/releases/latest)** (a universal DMG
for Apple Silicon and Intel, macOS 13 or later).

1. Open the DMG and drag **SlayBudget** to **Applications**.
2. The first time, right-click SlayBudget in Applications and choose **Open** (or go to System Settings > Privacy &
   Security > **Open Anyway**). SlayBudget isn't notarized by Apple yet, so macOS asks once.
3. If macOS says the app "is damaged", run this once in Terminal, then open it again:
   ```sh
   xattr -dr com.apple.quarantine /Applications/SlayBudget.app
   ```

**Updates are automatic.** SlayBudget checks for new versions when it opens and every 6 hours, shows you what's new
since your version, and installs only when you click. See the [changelog](CHANGELOG.md).

### Windows and Linux (untested)

Every release also builds SlayBudget for Windows and Linux, from the same code. **These builds haven't been tested on a
real Windows or Linux machine yet**, so expect rough edges. If something doesn't work, please
[open an issue](https://github.com/ashvtol/SlayBudget/issues) with your OS version and what you saw.

- **Windows 10 or 11 (64-bit):** download **SlayBudget_*_x64-setup.exe** (or the **.msi**) from the
  [latest release](https://github.com/ashvtol/SlayBudget/releases/latest) and run it. The installer isn't code-signed
  yet, so SmartScreen may say "Windows protected your PC": choose **More info > Run anyway**.
- **Linux (64-bit):** download the **.AppImage**, make it executable (`chmod +x SlayBudget_*.AppImage`) and run it, or
  install the **.deb** on Debian and Ubuntu (`sudo apt install ./SlayBudget_*.deb`).

What's different from the Mac app: shortcuts use **Ctrl** instead of ⌘ (Ctrl+Z / Ctrl+Y to undo and redo), the window
has the system's own title bar, and notifications are the system's standard ones (clicking one doesn't open the item
yet). Updates are automatic here too.

### Build from source

Prerequisites: Xcode Command Line Tools (`xcode-select --install`), [Rust](https://rustup.rs) and Node.js 22+.

```sh
git clone https://github.com/ashvtol/SlayBudget.git
cd SlayBudget
npm install
npm run dev                          # try it in your browser with sample data
npx tauri build --bundles app        # or build SlayBudget.app
```

Your data lives in `~/Library/Application Support/dev.ashvtol.slaybudget/slaybudget.db`.

## Organizing statements with folders

You can drop statements in from anywhere: SlayBudget works out the account from what's in the file, or asks you once
and remembers. If you like folders, give each account its own folder and SlayBudget does the rest:

```text
Statements/              ← your watched folder (Settings > Import sources)
├── Amex Gold/           → imported into Amex Gold
│   └── 2026-11.csv
└── Citi Checking/       → imported into Citi Checking, tagged "Bills" (its default tag)
    └── november.pdf
```

1. Choose a watched folder in **Settings > Import sources**.
2. In **Settings > Accounts**, click **Create a folder for each account**.
3. Drop statements into the right folder. SlayBudget checks every couple of minutes and the bell tells you what it
   imported.

**Folder → account → tag.** The folder decides the account. If that account has a **default tag** (Settings >
Accounts), everything it imports gets that tag too, so a "Business" card's folder fills up your Business tag on its
own. A folder whose name doesn't match an account is asked about once, with the folder's name suggested for a new
account. Files are only read, never moved or changed.

## FAQ

<details>
<summary><b>Is SlayBudget really free?</b></summary>

Yes. It's open source under the MIT license, with no paid tier and no ads.
</details>

<details>
<summary><b>Does it connect to my bank?</b></summary>

No. You download statements (CSV, PDF or QFX) from your bank's website and drop them in, or point SlayBudget at a
folder. Nothing logs in to your bank and no third party sees your transactions.
</details>

<details>
<summary><b>Which banks and card issuers are supported?</b></summary>

American Express and Citi (credit cards and checking) have dedicated importers. Any bank that exports CSV works with
the generic importer, and QFX/OFX files work from most US banks. New layouts are easy to add: see
`crates/core/src/import`.
</details>

<details>
<summary><b>Is my financial data private?</b></summary>

Yes. Everything is stored in one local SQLite database. There's no account, no telemetry and no server. Back it up
from Settings > Data and backup, or with Time Machine.
</details>

<details>
<summary><b>Can I move from another budgeting app?</b></summary>

Yes. Import transactions from a JSON export, and import categorization rules so your merchants are categorized the way
you're used to.
</details>

<details>
<summary><b>Will it remind me about bills?</b></summary>

Yes. The bell in the top bar and Mac banners tell you about upcoming bills (as many days ahead as you like), bills
that look missed, price changes, possible double charges, large purchases and budgets running over. Banners appear
while SlayBudget is open, and quiet hours hold them overnight.
</details>

<details>
<summary><b>I don't see Mac banners. What's wrong?</b></summary>

Open Settings > Notifications and reminders. Under "Mac banners" SlayBudget says what macOS does with its banners:
shows them, only puts them in Notification Center (set SlayBudget's alert style to Banners), blocks them, or hasn't
been asked yet (click **Allow banners**). **Open System Settings** takes you straight there. **Send a test banner** at
the bottom shows one right away. Banners pop up even while SlayBudget is in front. They don't while it's quit, during
quiet hours (held until they end), for kinds whose Banner switch is off, for alerts you already read in the bell, or
in a Focus mode; more than 3 at once arrive as one summary banner.
</details>

<details>
<summary><b>How does SlayBudget know which account a statement is?</b></summary>

From the file itself: the account's last 4 digits (in a PDF, a QFX file, an Amex CSV or a file name like
`Chase1004_Activity.csv`), the bank, the CSV's columns, or the account folder it sits in. When that's not enough, it
asks you once, with its best guess first, and remembers your answer, so next month's statement goes straight in. You
can see and change what each account is recognized by in Settings > Accounts, move an import to another account from
Recent imports, and have SlayBudget make a folder for each account in your watched folder.
</details>

<details>
<summary><b>I dropped in 50 statements. Do I have to answer 50 times?</b></summary>

No. Statements from the same card (same bank and last 4 digits) are asked about together, once: "Which account is
Chase ending 7781?" covers all of them, and a new account is made only once. **Import all** puts every group into its
likely account (or a new one named after the card) and **Skip all** leaves them out. Statements without an account
number are listed together with a checkbox each, so you can pick the ones that go into the same account.
</details>

<details>
<summary><b>Can it import statements from my Downloads folder?</b></summary>

Yes, if you turn it on in Settings > Import sources. Statements you download from then on are imported on their own
(ones it can't place wait on the Import page), anything that isn't a statement is ignored, and your files are never
moved or changed.
</details>

<details>
<summary><b>Can I see everything in another currency?</b></summary>

Yes. Pick a display currency in Settings > Currency and every amount is shown in it, converted at the average rate of
its own month (or at the latest rates, if you prefer). The rates are the European Central Bank's monthly averages,
built into SlayBudget and refreshed with each update, so converting never goes online. Your data keeps the currency
it was imported in, and a converted transaction shows what it originally was.
</details>

<details>
<summary><b>A subscription changed price. Does SlayBudget notice?</b></summary>

Yes. A saved bill claims charges near its usual amount. When a charge from the same merchant comes in well above or
below that (an upgrade, a downgrade, a new plan), SlayBudget asks once: "Is this Netflix at a new price?" Say **Yes,
new price** and the bill follows the new amount and due day, keeping a price history; **No, a one-off** leaves the
bill alone; **A separate subscription** makes it its own bill. The question shows on the charge, on the bill in
Recurrings and in the bell. If you end up with two bills for the same subscription, including one whose name changed
on your statement, Recurrings offers to merge them (⌘Z undoes it); the merged bill keeps every name.
</details>

<details>
<summary><b>A card pays back one of my subscriptions. Can SlayBudget show that?</b></summary>

Yes. When credits from one name keep matching a bill's charges (the same amount within 10 days, or part of a
purchase on the same day, like a store credit with each order), Recurrings asks "Do they pay it back?" The ⓘ beside it lists
each charge with the credit that matched it. Say **Link**, or set **Paid back by** in the bill's rules, or open the
credit and choose **Pays back a bill**. The bill stays in your list with a **Credited** tag, each charge shows its
credit even when it lands on another day, and Key metrics show what was credited and what it cost you. One credit can
pay back several bills (a monthly entertainment credit split between two streaming services): each piece counts once, for
the nearest charge. A bill that comes back in full doesn't count toward "left to pay".
</details>

<details>
<summary><b>How does SlayBudget decide a category, and can I undo it?</b></summary>

In this order: your rules, a merchant you've categorized before, then a small classifier that learns from every category
you choose (and starts from a built-in list of common merchants), then your bank's own category, then keywords. It runs
on your Mac; nothing about your transactions is sent anywhere. When the classifier is sure, it sets the category and the
transaction says why ("Like 6 others you put in Coffee" or "Known merchant: Starbucks"). When it isn't, you get a
suggestion to accept, reject or swap for another (Transactions > Filter > Review status > Suggested category, or **Check** on the
Dashboard). A category you chose yourself is never changed. Changing one transaction moves that merchant's other ones
with a note: **Undo** takes it all back (as does ⌘Z) and **Only this one** puts the others back. Turn off automatic
categorizing, or reset what it learned, in Settings > Categorization.
</details>

<details>
<summary><b>Why aren't transfers between my accounts counted as spending?</b></summary>

When money leaves one of your accounts and the same amount arrives in another within a few days (4 by default, set in
Settings > Categorization), that's money moving, not money spent. SlayBudget pairs the two sides and makes both a
Transfer, or a Payment when one side is a credit card. Pairs whose descriptions say "transfer" or "payment" are applied;
others are suggested for you to confirm. The transaction links to its other side.
</details>

<details>
<summary><b>Can I undo a mistake?</b></summary>

Yes. ⌘Z undoes your last change and ⇧⌘Z redoes it, up to 15 steps back: categories (including the history that moved with them),
reviews, notes, tags, splits, deletes, budgets, recurring bills, rules and imports. While you're typing in a field, ⌘Z
undoes your typing instead. Settings aren't part of undo, and the steps are cleared when you quit.
</details>

<details>
<summary><b>What if I import overlapping statements?</b></summary>

Rows that match exactly are skipped, so importing the full month after a mid-month download only adds what's new.
Rows that look like ones you already have but don't match exactly (a PDF that words a merchant differently, a tip
added after the fact, a card hold, or a pending charge that posted days later) are imported, tagged "Possible
duplicate" and marked to review, with an explanation. Filter by the tag, then delete one of the pair or mark it "Not a
duplicate". SlayBudget never deletes anything on its own. If a whole import was a mistake, undo it from Recent
imports on the Import page.
</details>

<details>
<summary><b>Where do the FIRE numbers come from?</b></summary>

From your own transactions, on your Mac. Your savings rate is income minus spending over the last 12 full months.
The FI number is 25 times a year of spending (the "4% rule"; the 3.5% figure beside it is the more careful version
for early retirement). Years to FI assume you start from zero, earn 5% a year after inflation and withdraw 4%: about
17 years at a 50% savings rate. They're illustrations and rules of thumb, not financial advice.
</details>

<details>
<summary><b>I hid a tip. Why did it come back?</b></summary>

A hidden tip stays hidden until its numbers change a lot: more than 10% (or 3 points for a percentage, like your
50/30/20 split). Then it's news again. You can also bring any hidden tip back from "hidden tips" under the list.
</details>

<details>
<summary><b>Will SlayBudget tell me about a new tip?</b></summary>

Yes. After each import (and when the app starts) it checks Your money habits, and a tip that's new, came back after you
hid it, or turned into a warning goes to the bell, and to a Mac banner if banners are on. Clicking it opens the tips on
Insights. More than 3 at once arrive as one. Turn them off under Settings → Notifications → Money tips. The no-spend
days tip never notifies (it changes every day), and the first check after updating stays quiet.
</details>

<details>
<summary><b>Windows or Linux?</b></summary>

Yes, but untested: every release includes Windows and Linux builds, made automatically from the same code, which
haven't been tried on a real Windows or Linux machine yet. See [Windows and Linux (untested)](#windows-and-linux-untested)
for how to install them, and please open an issue if something doesn't work. SlayBudget is designed and tested on
macOS. Contributions are welcome.
</details>

## Tech stack

**Tauri 2** · **Rust** (rusqlite, SQLite) · **React 19** · **TypeScript** · **Vite** · **Tailwind CSS** · **visx** ·
**Zustand** · **Vitest**

```
crates/core   Rust business logic: storage and migrations, importers, categorization, budgets, analytics
src-tauri     The Tauri app shell and commands
src           The React UI
```

Money is stored as integer cents, never as floating point. [ARCHITECTURE.md](ARCHITECTURE.md) explains how the pieces
fit and when each rule runs; design decisions live in `SPEC.md`, `CONSTRAINTS.md` and `docs/adr/`.

## Contributing

Contributions are welcome: new bank importers, features and fixes. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md), and run `npm run check` before opening a pull
request.

If SlayBudget helps you, **please ⭐ star the repo**. It helps other people find a private, free budgeting app.

## License

[MIT](LICENSE) © ashvtol

<sub>SlayBudget is an independent project and is not affiliated with Copilot Money, YNAB, Intuit or Mint. Product names
are used only to describe compatibility and alternatives.</sub>
