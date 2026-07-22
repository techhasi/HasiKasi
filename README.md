# HasiKasi 💸

Personal budgeting PWA — local-first, zero running cost, built for iPhone via "Add to Home Screen".

**Live app:** https://techhasi.github.io/HasiKasi/

## Features

- Expense / income / transfer logging with custom categories, accounts, notes, and receipt photos
- **Salary-cycle budget months** — a "month" runs from salary date to the day before the next salary, with optional balance carry-over
- Bank **SMS import**: paste (or auto-copy via an iOS Shortcut) bank messages, approve parsed transactions from an inbox; accounts auto-matched by last-4 digits
- Per-category **budgets** with progress bars; stats with charts per budget period
- **Recurring payments & loans** with due-date scheduling and payoff progress
- **Credit card dues** (statement amount or outstanding balance, due end of month) with pay-by-transfer flow
- **Investments & savings** tracking, included in net worth
- Duplicate-transaction warnings
- Backups: manual JSON export/restore + automatic daily/per-cycle backups to a private GitHub repo
- Email reminders via GitHub Actions (daily, salary week, card due)

## Stack

React 19 · Vite · TypeScript · Tailwind CSS v4 · Dexie (IndexedDB) · Recharts · vite-plugin-pwa — deployed to GitHub Pages on every push to `main`.

All data stays in the browser's IndexedDB on the device; there is no server.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # typecheck + production build
```

An in-app guide lives in **Settings → How HasiKasi works**.
