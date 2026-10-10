# Habit Tracker — Project Context

Paste this file's content into a new chat session to continue development.

---

## Stack

- **Pure Vanilla JS** — no build tools, no framework. `app.js` is a classic deferred script; Firebase is pulled in with dynamic `import()`
- **Firebase Firestore v10.12.0** (`FB_VERSION`) — module loaded once into `fs`, multi-tab IndexedDB cache (`persistentLocalCache` + `persistentMultipleTabManager`), real-time `onSnapshot`
- **Gemini API** — `POST {GEMINI_API}/models/{model}:generateContent`, key sent in the `x-goog-api-key` header
- **Files**: `index.html`, `app.js` (~2800 lines), `style.css` (~1100 lines), `README.md`, `PROJECT_CONTEXT.md`
- **Hosting**: GitHub Pages from `main` (no cache-busting query strings; Pages revalidates after ~10 min, hard-refresh to see a deploy sooner)
- **Local dev**: `python -m http.server 5500` from project root, open `http://localhost:5500`
- **OS**: Windows. Git remote: `origin/main`

---

## Data Model

```js
let state = {
  habits: [], // [{id, name, order, days, startDate, endDate}] — tracker/habits doc
  checks: {}, // {day: {habitId: 'tick'|'cross'|'dash'}}  (legacy `true` = tick)
  successDays: {}, // {day: 'success'|'fail'}
  notes: {}, // {day: string}
  calories: {}, // {day: [{id, food, cal, time}]}
  calorieGoal: 2000,
  markOrder: {}, // {day: [habitId, ...]} — order habits were first marked
};
state.globalNote = ""; // Notes-view "Month Note", shared across months
```

| Firestore doc       | Contents                                                     |
| ------------------- | ------------------------------------------------------------ |
| `tracker/habits`    | `{list: [...habits]}`                                        |
| `tracker/global`    | `{monthNote, calorieGoal}`                                   |
| `tracker/{YYYY-MM}` | `checks, successDays, notes, calories, markOrder, year, month, updatedAt` |

Older month docs may still contain a `bodyAnalysis` field from the removed Photo Check-ins feature; nothing reads it. Reset Month deletes it.

localStorage keys: `tracker_fb_config`, `tracker_gemini_key`, `tracker_gemini_model` (auto-discovered), `tracker_avg_range_config`, `tracker_theme`.

---

## Saving (important)

- Month edits call **`saveMonthFields({ "dotted.path": value })`** — only the changed fields are written (`setDoc(..., {merge: true})`); `undefined` deletes the field.
  - e.g. `saveMonthFields({ [`checks.${day}.${habitId}`]: next, [`markOrder.${day}`]: [...] })`
- Writes are queued **per doc ID** and flushed after 600 ms (`flushMonthFields`), and on `visibilitychange`/`pagehide`. Keying by doc means switching months mid-batch can't misdirect edits.
- The short batch window is deliberate: the grid re-sorts marked habits on the next snapshot, and the delay lets the user tap a cell again (tick → cross → dash) before it moves.
- `applyMonthData()` overlays still-queued edits on incoming snapshots so they don't flicker away.
- `saveHabits()` / `saveGlobalNote()` replace their whole (small) docs and are **not awaited** — the local cache applies them immediately; awaiting would stall offline.
- `trackWrite()` drives the sync indicator (`Synced` / `Saving…` / `Offline` / `Save failed`).

---

## Key State & Helpers

```js
let viewYear, viewMonth, viewDay;            // what the user is viewing
let CURRENT_YEAR, CURRENT_MONTH, CURRENT_DAY; // real today — refreshed by syncToday()
let singleDayView = true;
let currentView = "grid";                     // only this view is rendered
let streakCarry = 0;                          // success run at the end of earlier months
```

- `isCurrentMonth()`, `isToday(day)`, `monthDocId(y, m)`, `DAYS_IN_VIEW()`, `isFuture(day)`
- `setViewMonth(y, m)` — all month navigation goes through this (re-subscribes only on change)
- `syncToday()` — runs every minute and on tab focus; rolls "today" over at midnight and follows along if the user was on today
- `esc(str)` / `escMultiline(str)` — **use for any user/AI text interpolated into `innerHTML`**
- `render()` = labels + stats + status banner + `renderView(currentView)`; snapshot callbacks use `scheduleRender()` to coalesce bursts

---

## Views (Sidebar + mobile bottom tab bar)

| ID              | Name                 | Nav button       |
| --------------- | -------------------- | ---------------- |
| `view-grid`     | Daily Grid (default) | `nav-grid` ▦     |
| `view-progress` | Progress             | `nav-progress` ◎ |
| `view-habits`   | Habit Manager        | `nav-habits` ✦   |
| `view-calories` | Calorie Counter      | `nav-calories` ◈ |
| `view-notes`    | Notes                | `nav-notes` ✎    |

Bottom tab IDs mirror these as `tab-*`. Selecting any nav item auto-closes the sidebar on mobile.

---

## Streaks

- `successRunEndingAt(day)` — consecutive `success` days ending on `day`, plus `streakCarry` if the run reaches day 1
- `streakAsOf(day)` — for today: unmarked counts up to yesterday, `fail` → 0; other days: run ending on that day
- `_computeCurrentStreak()` — live streak as of real today (0 when viewing another month)
- `loadStreakCarry(y, m)` — on month subscribe, walks back through previous month docs (usually one cached read)
- Per-habit streaks (Progress view) skip non-scheduled days and stay within the viewed month
- Streak protection: `confirmStreakBreak(onConfirm)` shows `#streakConfirmModal` before marking today failed with a running streak (used by `cycleDay` and `setDayVerdict`)

---

## Habit Scheduling

- `days`: array of JS `getDay()` ints (0=Sun…6=Sat) — null/empty = every day
- `startDate` / `endDate`: `"YYYY-MM-DD"`; habit hidden outside the range (past marks preserved)
- `isHabitActiveOnDate(habit, year, month, day)` filters the single-day grid, Today counts, and per-habit streaks; multi-day grid shows a striped `.td-inactive` cell

---

## Calorie Counter — 3 Entry Modes

All entries go through `logCalories([{food, cal}])` (timestamps, saves, re-renders).

1. **Manual** — food + kcal → "+ Add"
2. **AI Text** — food → ⚡ → `estimateCaloriesFromText` returns `{food, calories, description}` → "✓ Use" logs it
3. **Photo** — 📷 → image downscaled to 1024px (`_resizeImage`) → `estimateCaloriesFromPhoto` returns `[{food, calories, description}]` → confirm modal → "Add Selected"

Gemini calls use JSON mode (`callGemini(..., { json: true })`), `maxOutputTokens: 2048`, and ignore `thought` parts. The model is auto-selected (newest non-thinking `flash`) and re-resolved after quota errors.

Daily average pill on Progress honours `avgRangeConfig` (month / last N days / custom range).

---

## Progress Tab

- Heroes: Today (scheduled habits done %) and Success Rate (success days / days elapsed)
- Pills: Streak (+ best), Successful, Failed, kcal today, daily avg
- 7-day slip history panel (`renderSlipHistory`), day breakdown bar, heatmap (tap → day modal), per-habit streak bars

## Grid View

- Status banner (`renderStatusBanner`): `state-fire` / `state-slipping` / `state-broken` / `state-neutral`
- Verdict bar (success/fail per day), day note banner, habit table
- Marked habits sink below a divider, ordered by `markOrder`
- Month progress bar (`monthFill`, `dayProgress`) is updated in `renderStats()`

## Notes View

- Month note textarea (`monthNoteInput`) → `state.globalNote`, auto-saves after 800 ms
- Day journal: all days newest-first; future days labelled "plan"

## Floating Chat Widget

- `toggleChat()`, `sendChat()`, `sendQuickChat()`, `clearChat()`
- Multi-turn: last 20 completed turns (`_chatHistory`) are sent; today's calorie context goes in `systemInstruction`

---

## Mobile UX

- `max-width: 640px` breakpoint; auto single-day view on small screens
- Sidebar is an overlay drawer; swipe right from the left edge opens, swipe left closes
- Pointer Events drag-to-reorder for habits

## CSS Theme

Dark (default) and light via `html[data-theme]`, toggled by `toggleTheme()`. Dark tokens include `--bg:#020612`, `--surface:#081827`, `--green:#00ffd1`, `--amber:#ffd36b`; `--sans:'Sora','Inter',sans-serif`; `--tab-bar-h:64px`.

---

## Inline handlers

HTML uses inline `onclick="fn()"`; those functions are listed in `Object.assign(window, {...})` at the bottom of `app.js` — add new ones there.

---

_Last updated: 2026-10-10_
