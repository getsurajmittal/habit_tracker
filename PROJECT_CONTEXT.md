# Habit Tracker — Project Context

Paste this file's content into a new chat session to continue development.

---

## Stack

- **Pure Vanilla JS (ES Modules)** — no build tools, no framework
- **Firebase Firestore v10.12.0** — dynamic CDN import, IndexedDB persistence, real-time `onSnapshot`
- **Gemini API** — `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=...`
- **4 files**: `index.html`, `app.js` (~2100 lines), `style.css` (~800 lines), `README.md`
- **Local dev**: `python -m http.server 5500` from project root, open `http://localhost:5500`
- **OS**: Windows

---

## Data Model

```js
let state = {
  habits: [], // [{id, name, cat, order}]  — stored in tracker/habits doc
  checks: {}, // {day: {habitId: 'tick'|'cross'|'dash'}}
  successDays: {}, // {day: 'success'|'fail'}
  notes: {}, // {day: string}
  calories: {}, // {day: [{id, food, cal, time}]}
  calorieGoal: 2000,
};
state.globalNote = ""; // month-level note
```

- Month data in Firestore doc `tracker/{YYYY-MM}` (checks, successDays, notes, calories, calorieGoal, monthNote)
- Habits in `tracker/habits`
- Global settings in `tracker/global`
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

## Calorie Counter

- Food input (`id="calFoodInput"`) — no character limit
- ⚡ button → `triggerAIFromFoodInput()` — manual AI calorie estimate (never auto-triggers)
- 📷 button → photo upload → Gemini vision per-item confirmation
- AI Setup modal → `aiSetupModal` — model auto-discovery
- Entries stored as `{id, food, cal, time}` per day

---

## Progress Tab

- **Hero 1 — Today**: habit completion % for viewDay
- **Hero 2 — Success Rate**: successDays / visibleDays (% of days marked successful)
- **Pills**: Streak, Successful days, Failed days, kcal today, daily avg
- **Streak logic**: if today (current day) is unmarked → count from yesterday backwards; if today = fail → 0; if today = success → include today
- **Day breakdown bar**: stacked success/fail/unmarked
- **Heatmap**: monthly grid, amber dot for days with calories logged
- **Habit Streaks section**: per-habit consecutive-days-done, sorted by streak desc, bar relative to best streak

---

## Grid View

- Eyebrow shows `"June 27, 2026"` (full date, updates with day nav)
- Verdict bar (`id="verdictBar"`) — separate from habit table, shows success/fail/clear buttons
- Day note banner (`id="dayNoteBanner"`) — above table in single-day view
- Marked habits (tick/cross/dash) sink to bottom of table below divider `row-done-divider`, regardless of category
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

- Sidebar is overlay drawer on `max-width: 640px`
- Swipe right from left edge (<32px) opens sidebar; swipe left closes it
- Backdrop `id="mobileBackdrop"` closes sidebar on tap
- Pointer Events API for habit drag-to-reorder (touch + mouse)

---

## CSS Theme

Dark. Tokens: `--bg:#0c0c0e`, `--surface:#141416`, `--green:#3ddc84`, `--amber:#f5a623`, `--red:#ff5f57`, `--blue:#4d9eff`, `--purple:#9b6dff`

---

## All Functions Exposed to `window`

All public functions are exported via `Object.assign(window, {...})` at the bottom of `app.js`.

---

## Git

Remote: `origin/main`. Run `git add . && git commit -m "..." && git push` to save.

---

_Last updated: 2026-06-27_
