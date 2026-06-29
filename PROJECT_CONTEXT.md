# Habit Tracker — Project Context

Paste this file's content into a new chat session to continue development.

---

## Stack

- **Pure Vanilla JS (ES Modules)** — no build tools, no framework
- **Firebase Firestore v10.12.0** — dynamic CDN import, IndexedDB persistence, real-time `onSnapshot`
- **Gemini API** — `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=...`
- **4 files + 1 context**: `index.html`, `app.js` (~2300 lines), `style.css` (~850 lines), `README.md`, `PROJECT_CONTEXT.md`
- **Local dev**: `python -m http.server 5500` from project root, open `http://localhost:5500`
- **OS**: Windows. Git remote: `origin/main`

---

## Data Model

```js
let state = {
  habits: [], // [{id, name, order, days, startDate, endDate}]  — stored in tracker/habits doc
  checks: {}, // {day: {habitId: 'tick'|'cross'|'dash'}}
  successDays: {}, // {day: 'success'|'fail'}
  notes: {}, // {day: string}
  calories: {}, // {day: [{id, food, cal, time}]}
  calorieGoal: 2000,
};
state.globalNote = ""; // month-level note
```

- Month data in Firestore doc `tracker/{YYYY-MM}` (checks, successDays, notes, calories, calorieGoal, monthNote)
- Habits in `tracker/habits` — no categories (removed)
- Firebase config stored in `localStorage` under key `tracker_fb_config`
- Gemini API key: `localStorage` key `tracker_gemini_key`
- Gemini model (auto-discovered & cached): `localStorage` key `tracker_gemini_model`

---

## Key State Variables

```js
let viewYear, viewMonth, viewDay;   // what the user is currently viewing
let singleDayView = true;           // single-day vs full-month grid
const CURRENT_YEAR, CURRENT_MONTH, CURRENT_DAY;  // actual today
```

---

## Views (Sidebar Navigation)

| ID              | Name                 | Nav button       |
| --------------- | -------------------- | ---------------- |
| `view-grid`     | Daily Grid (default) | `nav-grid` ▦     |
| `view-progress` | Progress             | `nav-progress` ◎ |
| `view-habits`   | Habit Manager        | `nav-habits` ✦   |
| `view-calories` | Calorie Counter      | `nav-calories` ◈ |
| `view-notes`    | Notes                | `nav-notes` ✎    |

Selecting any nav item auto-closes the sidebar on mobile.

---

## Habit Scheduling

Each habit can have:

- `days`: array of JS `getDay()` ints (0=Sun…6=Sat) — null/empty = every day
- `startDate`: ISO date string `"YYYY-MM-DD"` — habit hidden on dates before this
- `endDate`: ISO date string — habit hidden after this (past marks preserved)

**`isHabitActiveOnDate(habit, year, month, day)`** — returns true if the habit should appear on that date. Used in:

- `renderGridBody()`: single-day view filters to applicable habits; multi-day view shows a dimmed striped cell for inactive day columns
- `renderStats()` and `renderProgressView()`: Today hero counts only applicable habits
- `renderProgressView()` habit streaks: non-applicable days are skipped (not streak-breaking)

UI: Add/Edit Habit modal has Mon–Sun toggle buttons (`id="habitDowToggles"`) and Start/End date pickers. Schedule badge shown in Habits list.

---

## Calorie Counter — 3 Entry Modes

1. **Manual** — type food name + enter calories manually → click "+ Add" → records as-is
2. **AI Text** — type food name → click ⚡ → AI returns `{food, calories, description}` → chip shows `"Food — ~250 kcal · serving detail"` → click "✓ Use" → **auto-records immediately** using AI food name + AI calories (no extra click needed)
3. **Photo** — click 📷 → camera/file → Gemini vision returns array → confirmation modal → click "Add Selected" → records checked items

`estimateCaloriesFromText` Gemini prompt returns `{food, calories, description}`.
`estimateCaloriesFromPhoto` returns `[{food, calories, description}, ...]`.
`acceptAISuggestion()` now directly pushes to `state.calories[viewDay]` and calls `scheduleSave()`.

AI Setup modal → model auto-discovery, key stored in localStorage.

---

## Progress Tab

- **Hero 1 — Today**: applicable habit completion % for viewDay (denominator = scheduled habits only)
- **Hero 2 — Success Rate**: successDays / visibleDays (% of days marked successful)
- **Pills**: Streak, Successful days, Failed days, kcal today, daily avg
- **Streak logic**: if today is unmarked → count from yesterday backwards; if today = fail → 0; if today = success → include today
- **Day breakdown bar**: stacked success/fail/unmarked
- **Heatmap**: monthly grid, amber dot for days with calories logged
- **Habit Streaks section**: per-habit consecutive applicable-days-done, sorted by streak desc

---

## Grid View

- Eyebrow shows `"June 29, 2026"` full date (updates with day nav)
- Verdict bar (`id="verdictBar"`) — separate from habit table, shows success/fail/clear buttons
- Day note banner (`id="dayNoteBanner"`) — above table in single-day view
- Marked habits (tick/cross/dash) sink to bottom below `row-done-divider`
- No categories — habits are ordered by drag-and-drop only
- Future days allowed for notes (labeled "Plan — Jun X")

---

## Notes View

- Month note textarea (`id="monthNoteInput"`) — auto-saves with 800ms debounce
- Day journal: all days newest-first, cards for days with notes, empty rows with "+ Add note"

---

## Floating Chat Widget

- `id="chatWidget"` — fixed bottom-right
- FAB `id="chatFab"` — toggles `id="chatPanel"`
- `toggleChat()` — open/close; `clearChat()` — wipes history
- Context-aware: sends calorie data as system context to Gemini
- Chatbot is Indian food aware; handles restaurant chains, place+dish combos

---

## Mobile UX

- Mobile-first design, `max-width: 640px` breakpoint
- Sidebar is overlay drawer on mobile; swipe right from left edge (<32px) opens, swipe left closes
- Backdrop `id="mobileBackdrop"` closes sidebar on tap
- Pointer Events API for habit drag-to-reorder (touch + mouse)
- All nav items auto-close sidebar on selection

---

## CSS Theme

Dark. Tokens: `--bg:#0c0c0e`, `--surface:#141416`, `--green:#3ddc84`, `--amber:#f5a623`, `--red:#ff5f57`, `--blue:#4d9eff`, `--purple:#9b6dff`

Key classes: `.dow-btn`/`.dow-btn.active` (schedule toggles), `.habit-sched` (purple schedule badge), `.td-inactive` (dimmed striped cell for non-scheduled day column), `.form-row`/`.form-half` (side-by-side form fields)

---

## All Functions Exposed to `window`

All public functions are exported via `Object.assign(window, {...})` at the bottom of `app.js`. Includes `toggleDowBtn` (needed for inline onclick on day-of-week buttons).

---

_Last updated: 2026-06-29_
