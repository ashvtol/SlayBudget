# Changelog

All notable changes to SlayBudget are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.10.2] - 2026-11-25
### Added
- **Choose what Cash flow counts.** Spend and Income details each have **Choose categories**: untick a category (say
  reimbursements, or money moved from savings) and it leaves the totals, the charts and Net income. Your choice is
  remembered.
- **Every income source, and where spending went.** Income details list each source with who paid it (Paycheck · your
  employer), and Spend details list each category with its top merchants.
### Fixed
- **Cash flow details show the month you click.** Click a month in Spend, Income or Net income's details to see its
  total and categories; click it again to go back to this month. Pointing only highlights the bar.
- **Income details show the average monthly income**, not spend.

## [0.10.1] - 2026-11-25
### Changed
- **Reviewed shows at a glance.** The transaction's button reads **Mark as Reviewed**, and turns green as **Reviewed**
  once it is, like a macOS toggle (no tick).

## [0.10.0] - 2026-11-25
### Added
- **Bills that are paid back.** When a card's statement credit refunds a subscription (a card's Walmart+ credit,
  say), the bill shows each charge with its credit, "Fully credited" or "Partly credited", and what it cost you. It
  stays in Recurrings with a Credited tag and doesn't count toward "left to pay". SlayBudget asks "Do they pay it
  back?" when credits keep matching, and a credit can be linked from its own detail with **Pays back a bill**.
- **Every ⓘ looks like macOS's info symbol**: a thin outlined circle, filled with the accent while its details show.
- **An ⓘ on "Is this … at a new price?"** shows the charge as the statement has it, so you can see who it was to.
- **Shared and partial credits.** One credit can pay back several bills (a card's monthly entertainment credit split
  between two streaming services): each credit counts once, for the nearest charge. A credit that covers part of a
  purchase on the same day (a store credit) shows as "Partly credited". "Do they pay it back?" asks about both, and its ⓘ
  lists each charge beside the credit that matched it.
- **A subscription whose statement name changed is suggested for merging** (HBO Max, then Max): one bill's charges
  end as the other's start, with related names or the same price on the same day. Two bills running at once are
  never suggested.
- **A bill can match several names**, for subscriptions whose statement name changed. Merging bills keeps every name.
- **Compare look-alike bills.** An ⓘ on "look like the same subscription" lays the bills side by side (what each
  matches, amount, frequency, due day, category, charges), with the differences standing out.
- **A bill's charges open in Transactions** when you click them, and show their full date (Sep 30, 2025) on one line.
- **A warning before saving a second copy of a bill** that has the same rule as one you already have.
### Fixed
- **Payment apps match the person, not the app.** "Make recurring" on a Venmo, Zelle or PayPal payment matches who it
  went to ("contains Sam Rivera"), and a payment to someone else is never asked about as the bill's new price.
- **A bill charged off its usual day still gets its tick.** A charge with the bill's name and amount links even away
  from the due day, when that billing period has no other charge (a coffee subscription billed on a different day each month).
  Payment apps (Venmo, Zelle, PayPal) still need the due day, since a payment there can be to anyone.
  Opening the app links charges older rules skipped.
- **Merging a renamed bill no longer invents a price change.** It compared the old bill's last price with the newer
  bill's latest one, so a later upgrade showed up as a change where the name changed; now it compares at the hand-over.
- **A price drop or rise inside a bill's range shows its arrow.** When a bill's latest charge is 10% or more off the
  one before (car insurance going from $120 to $96, say), Recurrings shows ↑ or ↓ and "Price went down" for 30 days.
  A drop's arrow is red.
- **A bill paid this month shows what you paid**, not its usual amount.
- **Opening a transaction from another screen works on the first visit** to Transactions (it showed the newest row).
- **A bill follows its charges' category.** Recategorizing a bill's latest charge moves the bill too, so it no longer
  keeps the category it was first detected with.
- **Copies of one bill make one merge suggestion**, not one for every pair. Merge joins them all; "Not the same"
  stops asking about the whole group.

## [0.9.0] - 2026-11-24
### Added
- **Smart categorization.** Imports use what SlayBudget learned from your own choices and a built-in list of about 900
  common merchants, all on your Mac. Money moved between your own accounts is paired as a transfer. Your history was
  sorted once (with a backup and Undo), and when SlayBudget isn't sure it suggests a category for you to accept,
  reject or change ("Choose another"). Settings → Categorization shows what it learned and can start over.
- **Changing a category fixes the rest of history**, with Undo and "Only this one". For payment apps (Wise, Zelle,
  PayPal) it asks which other payments go there too, since each can be for something different.
- **Set category** for several selected transactions at once.
- **Statement details behind an ⓘ** in lists you choose from and beside each name in Clean up Other, with a × to
  close them.
- **Bills every 2, 3 or 4 years**, for subscriptions bought several years at a time.
- **Import several statements at once.** Statements waiting for an account are grouped by bank and last 4 digits, so
  you answer once per account, with Import all and Skip all.
### Changed
- **Category menus are searchable everywhere.** Typing "S" used to jump to Restaurants because every option started
  with an emoji.
- **No focus ring around text fields and dropdowns.** They show the caret (or their normal look) when focused.
- **"Where your money went"**: tile colours blend evenly with the card, and the hover card stands out on a lighter
  surface.
### Fixed
- **Clean up Other**: "Just this one" now moves the transaction; the offer opens under the row you picked and counts
  only what's left in Other; transfers are left out; it shows what is left when you come back; and the Dashboard's
  Clean up always opens it.
- **⌘K results show their categories** even before you've opened Transactions.
- **The spending map's hover card and the emoji picker are never cut off** at the edge of their panel.

## [0.8.4] - 2026-11-23
### Fixed
- **"Needs category" no longer breaks onto two lines** next to a long transaction name (in search and lists).
### Changed
- **Suggested budget shows your budget now.** A Budget column sits next to the average, and each suggestion says how it
  compares: ↓ lower, ↑ raise (when your budget is below what you can realistically keep to), same, or new. Use these
  budgets changes only the ones that differ and says how many ("2 changed, 1 new").

## [0.8.3] - 2026-11-23
### Fixed
- **No more hard focus box around the search row.** Fields with no box of their own (transaction search, the search
  palette, renaming a tag, a new category's name and budget) now show just the caret while you type.

## [0.8.2] - 2026-11-23
### Fixed
- **Save budget looked greyed out in the Graphite theme.** It had white text on Graphite's white accent; it (and the
  group budget and Rebalance saves) is now a standard Mac button, readable in every theme.

## [0.8.1] - 2026-11-23
### Added
- **Money tip notifications.** When Your money habits has a new tip, one comes back after you hid it, or one turns into
  a warning, it goes to the bell (and a Mac banner, if they're on). Clicking it opens the tips on Insights. More than 3
  at once arrive as one; Settings → Notifications → Money tips turns them off. The first check after updating stays
  quiet.

## [0.8.0] - 2026-11-23
### Added
- **Your money habits** on Insights, below "Where your money went" and based on all your history (the time range at
  the top doesn't change it):
  - **Your money style**: FIRE (Financial Independence, Retire Early) or Soft saving, with a ? that explains both.
    FIRE shows your savings rate, your FI number (25 times a year of spending, and the 3.5% version) and about how many
    years to independence; Soft saving shows whether you're saving 20% and what's guilt-free to spend this month.
  - **Suggested budget**: pick a target savings rate and SlayBudget suggests budgets for your flexible spending (needs
    and bills stay as they are). FIRE trims in proportion, never more than half; Soft saving trims what crept up first.
    Untick any category to leave it out (small ones and Other start out; the header checkbox ticks all or none), adjust
    the amounts (or Cancel), then **Use these budgets**; ⌘Z takes them all back.
  - **Tips**: the 50/30/20 split, an emergency fund target, spending growing faster than income, what subscriptions
    cost a year, small purchases that add up, no-spend days and paying yourself first. Hide a tip and it comes back if
    its numbers change a lot.
- **Tips on the Dashboard**: your savings rate against your goal and the two most useful tips.
- **Essential categories**: mark a category as a need (rent, groceries, bills you can't skip) from its ⋯ menu. Rent,
  groceries, utilities, phone, internet, insurance, fuel and the like start out marked.

### Changed
- **Faster Insights and Dashboard.** Totals that leave out split transactions now look them up once instead of for
  every row, so screens that add up all your history open without a pause.
- **Dashboard:** Next two weeks moves to the left column, under Net this month.
- Insights no longer shows the "recurring charges" card; the subscriptions tip replaces it (and leaves out rent and
  other needs).

## [0.7.0] - 2026-11-23
### Changed
- **New charts everywhere.** Every chart is redrawn in Copilot's style and follows your pointer with no lag:
  - **Cash flow**: move across a chart and the card's header shows that month against the same month last year; the
    month lights up (a brighter green or red) while the others dim, with no tooltip box. **Spend** stacks each month by
    category and lists that month's categories in a small card.
  - **Dashboard**: the monthly spending line turns from green to yellow to orange as you get ahead of your budget's
    pace, with a "$37 over" or "$120 under" pill at today, money and day axes, and a card for any day showing what you'd
    spent and what the budget allowed by then.
  - **Categories**: 24 months as rounded bars (green within budget, orange over), the budget as a stepped line with
    its amount, and months with nothing spent shown as dashes. Point at a month to see it, click to open it.
  - **Insights**: the spending map keeps its tiles, colors and drill-in, with a matching hover card.

### Fixed
- **Rolling numbers no longer jump when they stop.** The digits rolled a few pixels lower than the number's resting
  place, so the whole number hopped once the roll ended.
- **Charts follow your pointer smoothly.** Dragging across any chart (Dashboard, Cash flow, Categories, Insights), the
  tooltip and guide line now stay with the pointer instead of trailing behind and stuttering.

## [0.6.2] - 2026-11-23
### Fixed
- **Mac banners pop up even while SlayBudget is in front.** Before, macOS only put them in Notification Center.

### Added
- Notification settings say what macOS does with SlayBudget's banners (shows them, only in Notification Center,
  blocked, or not asked yet) and how to fix it, with **Allow banners** and **Open System Settings**.
- With banners on, SlayBudget asks macOS once at launch, so the first banner isn't lost.

## [0.6.1] - 2026-11-23
### Added
- **Resizable panes.** Drag the line between a list and its detail (Transactions, Categories, Recurrings) to give
  either side more room. It's remembered per page; double-click to reset, or use the arrow keys.
- **Send a test banner**, at the bottom of Notification settings. If it doesn't show, SlayBudget tells you where to
  allow its banners (with a button to open System Settings > Notifications).
- Notification settings say when quiet hours are holding banners right now.

### Changed
- A recent price change on Recurrings is a green arrow beside the bill's tag, so names are no longer cut short.

## [0.6.0] - 2026-11-22
### Added
- **Subscriptions that change price.** When a bill's merchant charges well above or below its usual amount (an
  upgrade, a downgrade), SlayBudget asks once: "Is this Equinox at a new price?" **Yes, new price** moves the bill to
  the new amount and due day and keeps a price history; **No, a one-off** leaves it alone; **A separate
  subscription** makes it its own bill. The question shows on the charge, on the bill and in the bell, and Recurrings
  shows "Price went up" or "Price went down" for 30 days.
- **Merge look-alike bills.** Two bills for the same subscription can be merged on the Recurrings page (or marked
  "Not the same"). Undoable.
- **Amounts in your currency, offline.** Pick a display currency in Settings > Currency and every amount converts:
  transactions, totals, budgets, charts, recurring bills and notifications, each at the rate of its own month (or the
  latest month, if you prefer). The rates (the European Central Bank's monthly averages for 30 currencies and the
  euro) are built into the app and refreshed with each update: nothing goes online to convert. Your data keeps its
  own currency, so switching back is exact, and a converted transaction shows what it originally was. Rupees group
  the Indian way (₹12,34,567).
- **Budgets in your currency.** Set a budget while showing rupees and your budgets move to rupees, so what you type
  is what you see.
- **Rolling numbers.** When amounts change, their digits roll like a ticker. Turn it off in Settings > Accessibility;
  it's always off with Reduce motion.
- The Import page explains how to keep statements organized: a folder for each account in your watched folder,
  with an example, and a **Set up folders** button. The README has the same guide.

### Changed
- Buttons, checkboxes, radio buttons, menus and text fields now look and feel like macOS: filled push buttons that
  press in, blue checkboxes and radio buttons, pop-up menus with the ↕ badge, a sliding segmented control and a
  soft focus ring.
- Notification settings: "Price went up" is now "Price changes", and also covers a possible new price and drops.

### Fixed
- Opening a notification about a transaction (a paycheck, a large charge) now shows that transaction.
- Editing a bill after its price changed keeps its older charges.

### Removed
- "Update rates", and the online exchange-rate service it used (it had stopped working).

## [0.5.0] - 2026-11-22
### Added
- **Statements land in the right account.** SlayBudget recognizes which account a statement belongs to from the file
  (the last 4 digits, the bank, its columns, or the account folder it's in). When it isn't sure, it asks once, "Which
  account is this?", showing what's in the file and its best guess, or lets you make a new account. It remembers your
  answer. Two cards from the same bank aren't mixed up.
- **Settings > Accounts**: name, bank, type (card, checking, savings), a default tag for everything an account imports
  (and, if you like, what it already has), what each account is recognized by, and a folder for each account in your
  watched folder.
- **Move an import** to another account from Recent imports (rows that account already has are dropped). Undoable.
- **Statements from your folders, automatically**: the watched folder is checked every few minutes (including account
  folders inside it), and optionally your Downloads folder too. The bell tells you what was imported, or which
  statement needs an account. Nothing else in those folders is touched.
- **Windows and Linux builds (untested).** Each release now includes a Windows installer (.exe and .msi) and Linux
  packages (.AppImage and .deb), built automatically from the same code. They haven't been tried on a real Windows or
  Linux machine yet: if something doesn't work, please open an issue. Shortcuts there use Ctrl (Ctrl+Z / Ctrl+Y).

## [0.4.0] - 2026-11-22
### Added
- **Undo and redo.** ⌘Z takes back your last change and ⇧⌘Z puts it back, up to 15 steps: categories (including
  "apply to others"), reviews, notes, tags, splits, deletes, budgets, recurring bills, rules and imports. The Edit menu
  names the step ("Undo Change Category"), and a short note says what was undone. While you're typing, ⌘Z still
  undoes your typing.

### Fixed
- Choosing a category (or a tag) after typing in the search takes one click again. macOS autocorrect no longer pops up
  under search, name and amount fields, where its bubble swallowed the first click.
- Dismissing a notification with × works again. After you'd visited more than one screen, the click closed the panel
  instead and the notification stayed.

## [0.3.0] - 2026-11-22
### Added
- **Possible duplicates.** When an import brings in a row that looks like one you already have but doesn't match
  exactly, it's tagged "Possible duplicate" (amber), marked to review, and explained: the same charge worded
  differently, a tip added later, a card hold replaced by the final charge, or a pending charge that posted up to a
  week later. Rows the new file repeats exactly are never flagged, so weekly habits stay quiet.
  - The import results list them ("3 to check"), and the bell gets one item per import.
  - In a flagged transaction: **Delete this one**, **Delete the other one**, or **Not a duplicate** (that pair is
    never flagged again).
- **Delete transactions**, one or many, from the selection bar or the trash button next to Review.
- **Undo an import** from the new Recent imports list on the Import page. It removes only what that file added, so
  you can import it again.
- A backup of your data is made before every delete or undo (the newest 3 of each are kept).

## [0.2.1] - 2026-11-22
### Changed
- Toggles slide smoothly, the way macOS switches do.

### Removed
- The "Send a test banner" button in notification settings.

## [0.2.0] - 2026-11-22
### Added
- **Notifications.** A bell in the top bar of every screen collects alerts, with an unread count; click one to jump
  straight to it.
  - Upcoming bills (you choose how many days before, and again on the due day) and bills that look missed.
  - Subscription price increases, possible double charges and large transactions.
  - Over budget or on pace to overspend, a monthly recap on the 1st, and a weekly "to review" reminder.
  - Paychecks and refunds arriving, and new versions of SlayBudget.
- **Mac banners** for the same alerts while SlayBudget is open; clicking one opens exactly what it's about. Quiet
  hours hold them overnight, and a burst of alerts arrives as one summary.
- **Notification settings**: turn each kind on or off for the bell and banners, and tune every threshold.

### Changed
- Bill reminders now follow the recurring bills you've saved, instead of guessing from your history.
- Settings switches are now macOS-style slide toggles.

## [0.1.0] - 2026-11-22

The first public release.

### Added
- Import bank and card statements: CSV, PDF and QFX/OFX, with built-in layouts for American Express, Citi credit
  cards and Citi checking, a generic CSV importer, duplicate detection and a watched folder.
- Automatic categorization that learns from your corrections, explicit rules, bank-provided categories, and a
  Clean up Other review.
- Dashboard with free to spend, net income, transactions to review, top categories and upcoming bills.
- Transactions with instant search, filters, splits, refunds, notes, tags, transaction types and statement details.
- Categories with budgets per category or group, per-month overrides, rollovers, rebalancing and 24 months of
  history; click a month to see it, and edit any transaction in a side pane.
- Cash flow, recurring bills and subscriptions with reminders, and an Insights spending map.
- Profiles for household members, four themes, accessibility settings and keyboard shortcuts.
- One-click database backup, and export of categorization rules with nothing that identifies you.
- Automatic update checks that show what's new between your version and the latest one.
