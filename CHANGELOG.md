# Changelog

All notable changes to SlayBudget are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

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
