// ── FIREBASE DYNAMIC IMPORT ────────────────────────────────────────────────────

const FB_CONFIG_KEY = "tracker_fb_config";

let db = null;
let MONTH_DOC_ID = "";
let unsubscribe = null;

// Live state from Firestore
let state = {
  habits: [], // [{id, name, cat, order}]
  checks: {}, // {day: {habitId: bool}}
  successDays: {}, // {day: 'success'|'fail'}
  notes: {}, // {day: string}
};

// Single month-level note (stored in month doc under `monthNote`)
// Global guideline note (shared across months)
state.globalNote = "";

// Current actual date (constants)
const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth();
const CURRENT_DAY = NOW.getDate();

// View state (what the user is looking at). Defaults to today.
let viewYear = CURRENT_YEAR;
let viewMonth = CURRENT_MONTH;
let viewDay = CURRENT_DAY;
let singleDayView = true; // show one day by default

const TODAY = NOW;
const YEAR = CURRENT_YEAR;
const MONTH = CURRENT_MONTH;
const TODAY_DAY = CURRENT_DAY;
function DAYS_IN_VIEW() {
  return new Date(viewYear, viewMonth + 1, 0).getDate();
}
function isFuture(day) {
  if (viewYear > CURRENT_YEAR) return true;
  if (viewYear < CURRENT_YEAR) return false;
  if (viewMonth > CURRENT_MONTH) return true;
  if (viewMonth < CURRENT_MONTH) return false;
  return day > CURRENT_DAY;
}
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// ── BOOT ─────────────────────────────────────────────────────────────────────

async function boot() {
  const saved = localStorage.getItem(FB_CONFIG_KEY);
  if (saved) {
    try {
      await initFirebase(JSON.parse(saved));
      return;
    } catch (e) {
      localStorage.removeItem(FB_CONFIG_KEY);
    }
  }
  showSetup();
}

function showSetup() {
  document.getElementById("setupScreen").classList.remove("hidden");
}

async function connectFirebase() {
  const raw = document.getElementById("firebaseConfigInput").value.trim();
  const errEl = document.getElementById("setupError");
  errEl.classList.add("hidden");

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    showError(
      errEl,
      "Invalid JSON. Paste the config object from Firebase console."
    );
    return;
  }
  if (!config.projectId || !config.apiKey) {
    showError(errEl, "Config is missing projectId or apiKey.");
    return;
  }

  try {
    await initFirebase(config);
    localStorage.setItem(FB_CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    showError(errEl, "Could not connect: " + e.message);
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

async function initFirebase(config) {
  // Dynamically import Firebase
  const { initializeApp } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"
  );
  const { getFirestore, doc, onSnapshot, setDoc, getDoc } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
  );

  const app = initializeApp(config, config.projectId); // unique name prevents re-init error
  db = getFirestore(app);
  // Enable IndexedDB offline persistence where supported
  try {
    const { enableIndexedDbPersistence } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
    );
    await enableIndexedDbPersistence(db);
    console.log("Firestore IndexedDB persistence enabled");
  } catch (err) {
    // Common cases: multiple tabs (failed-precondition) or unsupported browser (unimplemented)
    console.warn(
      "Could not enable IndexedDB persistence:",
      err.code || err.message || err
    );
  }
  // Show app, hide setup
  document.getElementById("setupScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");

  // Subscribe to the currently viewed month (defaults to current month)
  subscribeToMonth(viewYear, viewMonth);

  // Load habits from separate doc (persist across months)
  const habitsRef = doc(db, "tracker", "habits");
  const habitsSnap = await getDoc(habitsRef);
  if (habitsSnap.exists()) {
    state.habits = habitsSnap.data().list || [];
  } else {
    // First-time: seed default habits
    state.habits = DEFAULT_HABITS.map((h, i) => ({
      ...h,
      id: uid(),
      order: i,
    }));
    await setDoc(habitsRef, { list: state.habits });
  }

  // Real-time habits listener
  onSnapshot(habitsRef, (snap) => {
    if (snap.exists()) {
      state.habits = (snap.data().list || []).sort((a, b) => a.order - b.order);
      render();
    }
  });

  // Global guideline note (stored in tracker/global)
  const {
    onSnapshot: onSnap2,
    doc: doc2,
    getDoc: getDoc2,
  } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
  );
  const globalRef = doc(db, "tracker", "global");
  const globalSnap = await getDoc2(globalRef);
  if (globalSnap.exists()) state.globalNote = globalSnap.data().monthNote || "";
  onSnap2(globalRef, (snap) => {
    if (snap.exists()) state.globalNote = snap.data().monthNote || "";
    render();
  });

  render();
}

// Subscribe to a month document and listen in real-time
async function subscribeToMonth(y, m) {
  if (!db) return;
  if (unsubscribe) unsubscribe();
  MONTH_DOC_ID = `${y}-${String(m + 1).padStart(2, "0")}`;
  const { doc, onSnapshot } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
  );
  const monthRef = doc(db, "tracker", MONTH_DOC_ID);
  unsubscribe = onSnapshot(
    monthRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        state.checks = data.checks || {};
        state.successDays = data.successDays || {};
        state.notes = data.notes || {};
      } else {
        state.checks = {};
        state.successDays = {};
        state.notes = {};
      }
      render();
      setSyncStatus("synced");
    },
    (err) => {
      console.error(err);
      setSyncStatus("offline");
    }
  );
}

// ── DEFAULT HABITS ────────────────────────────────────────────────────────────

const DEFAULT_HABITS = [
  { name: "Wake up", cat: "Morning" },
  { name: "Freshen up", cat: "Morning" },
  { name: "Black coffee", cat: "Morning" },
  { name: "Chyawanprash", cat: "Morning" },
  { name: "Handgripper", cat: "Morning" },
  { name: "Hair repair serum", cat: "Morning" },
  { name: "Hair oil", cat: "Morning" },
  { name: "Shower", cat: "Morning" },
  { name: "Facecare", cat: "Morning" },
  { name: "Minoxidil", cat: "Morning" },
  { name: "Pooja", cat: "Morning" },
  { name: "Breakfast", cat: "Morning" },
  { name: "Fat burner (AM)", cat: "Health" },
  { name: "Office", cat: "Work" },
  { name: "Lunch", cat: "Health" },
  { name: "Fat burner (PM)", cat: "Health" },
  { name: "Gym/Walk", cat: "Health" },
  { name: "Shower (Shampoo)", cat: "Evening" },
  { name: "Multivitamin", cat: "Evening" },
  { name: "Dinner", cat: "Evening" },
  { name: "Fat burner (Night)", cat: "Evening" },
  { name: "Facecare (PM)", cat: "Evening" },
  { name: "Minoxidil (PM)", cat: "Evening" },
];

// ── SAVE TO FIRESTORE ─────────────────────────────────────────────────────────

let saveTimer = null;
function scheduleSave() {
  setSyncStatus("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

async function flushSave() {
  if (!db) return;
  const { doc, setDoc } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
  );
  const monthRef = doc(db, "tracker", MONTH_DOC_ID);
  await setDoc(monthRef, {
    checks: state.checks,
    successDays: state.successDays,
    notes: state.notes,
    year: viewYear,
    month: viewMonth + 1,
    updatedAt: Date.now(),
  });
}

async function saveGlobalNote() {
  if (!db) return;
  const { doc, setDoc } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
  );
  const gRef = doc(db, "tracker", "global");
  await setDoc(gRef, { monthNote: state.globalNote });
}

async function saveHabits() {
  if (!db) return;
  const { doc, setDoc } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
  );
  await setDoc(doc(db, "tracker", "habits"), { list: state.habits });
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function render() {
  renderLabels();
  renderGrid();
  renderProgress();
  renderHabitsList();
  renderStats();
}

function renderLabels() {
  const label = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
  document.getElementById("sidebarMonth").textContent = label;
  document.getElementById("gridMonth").textContent = label;
  document.getElementById("progressMonth").textContent = label;
  // Show month note preview in sidebar
  const noteEl = document.getElementById("sidebarMonthNote");
  if (noteEl) {
    if (state.globalNote && state.globalNote.trim()) {
      const firstLine = state.globalNote.split("\n")[0];
      noteEl.textContent =
        firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine;
      noteEl.title = state.globalNote;
      noteEl.classList.remove("empty");
    } else {
      noteEl.textContent = "(no month note)";
      noteEl.title = "";
      noteEl.classList.add("empty");
    }
  }
  // dashboard sticky note (main area)
  const dashNote = document.getElementById("dashboardStickyNote");
  if (dashNote) {
    if (state.globalNote && state.globalNote.trim()) {
      dashNote.textContent = state.globalNote;
      dashNote.classList.remove("hidden");
    } else {
      dashNote.textContent = "";
      dashNote.classList.add("hidden");
    }
  }
}

// ── GRID ──────────────────────────────────────────────────────────────────────

function renderGrid() {
  renderGridHead();
  renderGridBody();
}

function renderGridHead() {
  const dim = DAYS_IN_VIEW();
  const days = singleDayView
    ? [viewDay]
    : Array.from({ length: dim }, (_, i) => i + 1);
  let html = `<tr>
    <th class="th-task">Habit</th>`;
  days.forEach((d) => {
    const isToday =
      viewYear === CURRENT_YEAR &&
      viewMonth === CURRENT_MONTH &&
      d === CURRENT_DAY;
    html += `<th class="${isToday ? "th-today" : ""}">${d}</th>`;
  });
  // Notes column
  html += `<th class="th-notes">Notes</th>`;
  html += `<th class="th-pct">%</th></tr>`;
  document.getElementById("hthead").innerHTML = html;
}

function renderGridBody() {
  const habits = state.habits;
  if (!habits.length) {
    const dim = DAYS_IN_VIEW();
    const days = singleDayView
      ? [viewDay]
      : Array.from({ length: dim }, (_, i) => i + 1);
    document.getElementById("htbody").innerHTML = `<tr><td colspan="${
      days.length + 3
    }" style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px">
        No habits yet — add some in the Habits tab.
      </td></tr>`;
    return;
  }

  // Group by category
  const catMap = {};
  habits.forEach((h) => {
    const c = h.cat || "General";
    if (!catMap[c]) catMap[c] = [];
    catMap[c].push(h);
  });

  let html = "";
  Object.entries(catMap).forEach(([cat, catHabits]) => {
    // Section row
    const dim = DAYS_IN_VIEW();
    const days = singleDayView
      ? [viewDay]
      : Array.from({ length: dim }, (_, i) => i + 1);
    html += `<tr class="row-section">
      <td class="section-name" colspan="${days.length + 3}">${cat}</td>
    </tr>`;

    catHabits.forEach((habit) => {
      const tid = habit.id;
      html += `<tr>`;
      html += `<td class="td-task">${habit.name}</td>`;
      let doneCount = 0;
      const dim2 = DAYS_IN_VIEW();
      const days2 = singleDayView
        ? [viewDay]
        : Array.from({ length: dim2 }, (_, i) => i + 1);
      days2.forEach((d) => {
        const checked = state.checks[d]?.[tid];
        const future = isFuture(d);
        if ((checked === "tick" || checked === "dash") && !future) doneCount++;
        const icon =
          checked === "tick"
            ? "✓"
            : checked === "cross"
            ? "✕"
            : checked === "dash"
            ? "—"
            : "";
        const cls =
          checked === "tick"
            ? "tick"
            : checked === "cross"
            ? "cross"
            : checked === "dash"
            ? "dash"
            : "";
        html += `<td>
          <button class="chk ${cls} ${future ? "future" : ""}"
            onclick="toggleCheck(${d},'${tid}',this)"
            title="${habit.name} — Day ${d}">${icon}</button>
        </td>`;
      });
      const visibleDays =
        viewYear === CURRENT_YEAR && viewMonth === CURRENT_MONTH
          ? CURRENT_DAY
          : DAYS_IN_VIEW();
      const pct =
        visibleDays > 0 ? Math.round((doneCount / visibleDays) * 100) : 0;
      html += `<td class="td-pct">${pct}%</td></tr>`;
    });
  });

  // ── Successful Day row ──
  const dim3 = DAYS_IN_VIEW();
  const days3 = singleDayView
    ? [viewDay]
    : Array.from({ length: dim3 }, (_, i) => i + 1);
  html += `<tr class="row-section"><td class="section-name" colspan="${
    days3.length + 3
  }">Daily Verdict</td></tr>`;
  html += `<tr class="row-succ">
    <td class="td-task" style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--green)">✦ Successful Day</td>`;
  days3.forEach((d) => {
    const v = state.successDays[d];
    const future = isFuture(d);
    let cls = future ? "future" : "";
    let icon = "·";
    if (v === "success") {
      cls += " success";
      icon = "✓";
    }
    if (v === "fail") {
      cls += " fail";
      icon = "✕";
    }
    html += `<td><button class="daybtn ${cls}"
      onclick="cycleDay(${d},this)" title="Day ${d}">${icon}</button></td>`;
  });
  html += `<td></td></tr>`;

  // ── Notes row ──
  html += `<tr class="row-note">
    <td class="td-task" style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--purple)">✎ Notes</td>`;
  days3.forEach((d) => {
    const has = !!state.notes[d];
    const future = isFuture(d);
    html += `<td class="td-notes"><button data-day="${d}" class="notebtn ${
      has ? "has-note" : ""
    } ${future ? "future" : ""}"
      title="${has ? "View/edit note" : "Add note"}">✎</button></td>`;
  });
  // spacer for month-notes column
  html += `<td></td>`;
  html += `<td></td></tr>`;

  document.getElementById("htbody").innerHTML = html;
  // Attach explicit click handlers to note buttons (more reliable than inline onclick)
  document.querySelectorAll(".notebtn").forEach((btn) => {
    const dayAttr = btn.getAttribute("data-day");
    if (!dayAttr) return;
    const dayNum = Number(dayAttr);
    // ensure future buttons don't react
    if (btn.classList.contains("future")) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openNote(dayNum);
    });
  });
  // Toggle table class for single-day styling
  document
    .getElementById("htable")
    .classList.toggle("single-day", singleDayView);
}

function isDoneValue(v) {
  return v === "tick" || v === "dash";
}

// ── INTERACTIONS ──────────────────────────────────────────────────────────────

function toggleCheck(day, habitId, btn) {
  if (!state.checks[day]) state.checks[day] = {};
  const cur = state.checks[day][habitId];
  // cycle: undefined -> tick -> cross -> dash -> undefined
  let next;
  if (!cur) next = "tick";
  else if (cur === "tick") next = "cross";
  else if (cur === "cross") next = "dash";
  else next = undefined;
  if (next) state.checks[day][habitId] = next;
  else delete state.checks[day][habitId];

  // update button appearance
  btn.classList.remove("tick", "cross", "dash");
  if (next) btn.classList.add(next);
  const icon =
    next === "tick" ? "✓" : next === "cross" ? "✕" : next === "dash" ? "—" : "";
  btn.textContent = icon;

  renderStats();
  scheduleSave();
}

function cycleDay(day, btn) {
  if (isFuture(day)) return;
  const cur = state.successDays[day];
  const next = !cur ? "success" : cur === "success" ? "fail" : undefined;
  if (next) state.successDays[day] = next;
  else delete state.successDays[day];

  btn.className = "daybtn" + (isFuture(day) ? " future" : "");
  if (next === "success") {
    btn.classList.add("success");
    btn.textContent = "✓";
  } else if (next === "fail") {
    btn.classList.add("fail");
    btn.textContent = "✕";
  } else btn.textContent = "·";

  renderStats();
  renderProgressView();
  scheduleSave();
}

// ── NOTES ─────────────────────────────────────────────────────────────────────

let activeNoteDay = null;
let activeMonthHabit = null;
let activeMonthNote = false;
function openNote(day) {
  if (isFuture(day)) return;
  activeMonthNote = false;
  activeMonthHabit = null;
  activeNoteDay = day;
  console.log("openNote: opening day note for", viewMonth, day);
  document.getElementById(
    "noteModalTitle"
  ).textContent = `Notes — ${MONTH_NAMES[viewMonth]} ${day}`;
  document.getElementById("noteText").value = state.notes[day] || "";
  openModal("noteModal");
  setTimeout(() => document.getElementById("noteText").focus(), 60);
}

function openMonthNote() {
  activeNoteDay = null;
  activeMonthHabit = null;
  activeMonthNote = true;
  document.getElementById(
    "noteModalTitle"
  ).textContent = `Month Notes — ${MONTH_NAMES[viewMonth]} ${viewYear}`;
  document.getElementById("noteText").value = state.globalNote || "";
  console.log("openMonthNote: opening month note editor");
  openModal("noteModal");
  setTimeout(() => document.getElementById("noteText").focus(), 60);
}

function saveNote() {
  const v = document.getElementById("noteText").value.trim();
  if (activeMonthNote) {
    state.globalNote = v || "";
    activeMonthNote = false;
    // persist global note immediately
    saveGlobalNote().catch((e) => console.warn("saveGlobalNote failed", e));
  } else if (activeMonthHabit) {
    // legacy: no-op (per-habit month notes removed)
  } else {
    if (!activeNoteDay) return;
    if (v) state.notes[activeNoteDay] = v;
    else delete state.notes[activeNoteDay];
  }
  closeModal("noteModal");
  renderGrid();
  renderProgressView();
  scheduleSave();
}

// removed per-habit month note function — now using a single month note

// ── HABIT CRUD ────────────────────────────────────────────────────────────────

let editingHabitId = null;

function openAddHabit() {
  editingHabitId = null;
  document.getElementById("habitModalTitle").textContent = "Add Habit";
  document.getElementById("habitNameInput").value = "";
  document.getElementById("habitCatInput").value = "";
  document.getElementById("habitModalError").classList.add("hidden");
  openModal("habitModal");
  setTimeout(() => document.getElementById("habitNameInput").focus(), 60);
}

function openEditHabit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  editingHabitId = id;
  document.getElementById("habitModalTitle").textContent = "Edit Habit";
  document.getElementById("habitNameInput").value = h.name;
  document.getElementById("habitCatInput").value = h.cat || "";
  document.getElementById("habitModalError").classList.add("hidden");
  openModal("habitModal");
  setTimeout(() => document.getElementById("habitNameInput").focus(), 60);
}

async function saveHabit() {
  const name = document.getElementById("habitNameInput").value.trim();
  const cat = document.getElementById("habitCatInput").value.trim();
  const errEl = document.getElementById("habitModalError");

  if (!name) {
    showError(errEl, "Habit name is required.");
    return;
  }

  if (editingHabitId) {
    const h = state.habits.find((x) => x.id === editingHabitId);
    if (h) {
      h.name = name;
      h.cat = cat;
    }
  } else {
    state.habits.push({
      id: uid(),
      name,
      cat,
      order: state.habits.length,
    });
  }

  closeModal("habitModal");
  await saveHabits();
  render();
}

async function deleteHabit(id) {
  if (
    !confirm(
      "Delete this habit? Your check data for it will remain stored but won't appear."
    )
  )
    return;
  state.habits = state.habits.filter((h) => h.id !== id);
  // Renumber
  state.habits.forEach((h, i) => (h.order = i));
  await saveHabits();
  render();
}

// Drag to reorder
let dragId = null;
function dragStart(id) {
  dragId = id;
}
function dragOver(e, id) {
  e.preventDefault();
  document
    .querySelectorAll(".habit-item")
    .forEach((el) => el.classList.remove("drag-over"));
  const el = document.querySelector(`[data-habit-id="${id}"]`);
  if (el) el.classList.add("drag-over");
}
async function drop(id) {
  document
    .querySelectorAll(".habit-item")
    .forEach((el) => el.classList.remove("drag-over"));
  if (!dragId || dragId === id) return;
  const fromIdx = state.habits.findIndex((h) => h.id === dragId);
  const toIdx = state.habits.findIndex((h) => h.id === id);
  if (fromIdx < 0 || toIdx < 0) return;
  const [item] = state.habits.splice(fromIdx, 1);
  state.habits.splice(toIdx, 0, item);
  state.habits.forEach((h, i) => (h.order = i));
  dragId = null;
  await saveHabits();
  render();
}

// ── RENDER HABITS LIST ────────────────────────────────────────────────────────

function renderHabitsList() {
  const el = document.getElementById("habitsList");
  if (!state.habits.length) {
    el.innerHTML = `<div class="habit-empty">No habits yet.<br>Click <strong>+ Add Habit</strong> to get started.</div>`;
    return;
  }
  el.innerHTML = state.habits
    .map(
      (h) => `
    <div class="habit-item" data-habit-id="${h.id}"
      draggable="true"
      ondragstart="dragStart('${h.id}')"
      ondragover="dragOver(event,'${h.id}')"
      ondrop="drop('${h.id}')">
      <div class="habit-item-left">
        <span class="habit-drag">⠿</span>
        <span class="habit-name">${h.name}</span>
        ${h.cat ? `<span class="habit-cat">${h.cat}</span>` : ""}
      </div>
      <div class="habit-actions">
        <button class="habit-btn" onclick="openEditHabit('${
          h.id
        }')" title="Edit">✎</button>
        <button class="habit-btn del" onclick="deleteHabit('${
          h.id
        }')" title="Delete">✕</button>
      </div>
    </div>`
    )
    .join("");
}

// ── STATS ─────────────────────────────────────────────────────────────────────

function renderStats() {
  const habits = state.habits;
  const n = habits.length;

  // Viewed day (shows counts for the currently selected day)
  const todayMap = state.checks[viewDay] || {};
  const todayDone = habits.filter((h) => isDoneValue(todayMap[h.id])).length;
  document.getElementById("hToday").textContent = `${todayDone}/${n}`;

  // Success days
  const succDays = Object.values(state.successDays).filter(
    (v) => v === "success"
  ).length;
  document.getElementById("hSucc").textContent = succDays;

  // Streak
  let streak = 0;
  for (let d = viewDay; d >= 1; d--) {
    if (state.successDays[d] === "success") streak++;
    else break;
  }
  document.getElementById("hStreak").textContent = streak;
}

// ── PROGRESS VIEW ─────────────────────────────────────────────────────────────

function renderProgress() {
  renderProgressView();
}

function renderProgressView() {
  const habits = state.habits;
  const n = habits.length;
  if (!n) return;

  // Month bar (based on viewed month)
  const daysIn = DAYS_IN_VIEW();
  const visibleDays =
    viewYear === CURRENT_YEAR && viewMonth === CURRENT_MONTH
      ? CURRENT_DAY
      : daysIn;
  const mPct = Math.round((visibleDays / daysIn) * 100);
  document.getElementById("monthFill").style.width = mPct + "%";
  document.getElementById("dayProgress").textContent = `Day ${Math.min(
    viewDay,
    daysIn
  )} of ${daysIn}`;
  document.getElementById("monthPct").textContent = mPct + "%";

  // Overall
  let total = 0,
    done = 0;
  for (let d = 1; d <= visibleDays; d++) {
    const dm = state.checks[d] || {};
    habits.forEach((h) => {
      total++;
      if (isDoneValue(dm[h.id])) done++;
    });
  }
  const overallPct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById("pOverall").textContent = overallPct + "%";
  document.getElementById("pOverallBar").style.width = overallPct + "%";

  // Today
  const todayMap = state.checks[viewDay] || {};
  const todayDone = habits.filter((h) => isDoneValue(todayMap[h.id])).length;
  const todayPct = n ? Math.round((todayDone / n) * 100) : 0;
  document.getElementById("pToday").textContent = todayPct + "%";
  document.getElementById("pTodayBar").style.width = todayPct + "%";

  // Success / fail / unmarked
  const succDays = Object.values(state.successDays).filter(
    (v) => v === "success"
  ).length;
  const failDays = Object.values(state.successDays).filter(
    (v) => v === "fail"
  ).length;
  const unmarked = visibleDays - succDays - failDays;
  document.getElementById("pSuccDays").textContent = succDays;
  document.getElementById(
    "pSuccSub"
  ).textContent = `of ${visibleDays} days passed`;
  document.getElementById("pFailDays").textContent = failDays;
  document.getElementById("pUnmarked").textContent = Math.max(0, unmarked);

  // Streak
  let streak = 0,
    bestStreak = 0,
    cur = 0;
  for (let d = viewDay; d >= 1; d--) {
    if (state.successDays[d] === "success") streak++;
    else break;
  }
  for (let d = 1; d <= visibleDays; d++) {
    if (state.successDays[d] === "success") {
      cur++;
      bestStreak = Math.max(bestStreak, cur);
    } else cur = 0;
  }
  document.getElementById("pStreak").textContent = streak;
  document.getElementById(
    "pBestStreak"
  ).textContent = `Best: ${bestStreak} day${bestStreak !== 1 ? "s" : ""}`;

  // Heatmap
  let hmHtml = "";
  const daysInMonth = DAYS_IN_VIEW();
  for (let d = 1; d <= daysInMonth; d++) {
    const v = state.successDays[d];
    const future = isFuture(d);
    const hasNote = !!state.notes[d];
    let cls = "";
    if (future) cls = "future-hm";
    else if (v === "success") cls = "succ";
    else if (v === "fail") cls = "fail";
    if (
      viewYear === CURRENT_YEAR &&
      viewMonth === CURRENT_MONTH &&
      d === CURRENT_DAY
    )
      cls += " today-hm";
    if (d === viewDay) cls += " today-hm";
    if (hasNote) cls += " has-note";
    hmHtml += `<div class="hm-day ${cls}" onclick="openDayModal(${d})" title="Day ${d}">${d}</div>`;
  }
  document.getElementById("heatmap").innerHTML = hmHtml;

  // Per-habit bars
  let barsHtml = "";
  habits.forEach((h) => {
    let hdone = 0;
    for (let d = 1; d <= visibleDays; d++) {
      if (isDoneValue(state.checks[d]?.[h.id])) hdone++;
    }
    const pct = visibleDays ? Math.round((hdone / visibleDays) * 100) : 0;
    barsHtml += `<div class="hbar-row">
      <div class="hbar-name" title="${h.name}">${h.name}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%"></div></div>
      <div class="hbar-pct">${pct}%</div>
    </div>`;
  });
  document.getElementById("habitBars").innerHTML = barsHtml;
}

// ── DAY MODAL ─────────────────────────────────────────────────────────────────

function openDayModal(day) {
  document.getElementById(
    "dayModalTitle"
  ).textContent = `${MONTH_NAMES[viewMonth]} ${day}, ${viewYear}`;

  const dayMap = state.checks[day] || {};
  const done = state.habits.filter((h) => isDoneValue(dayMap[h.id]));
  const pending = state.habits.filter((h) => !isDoneValue(dayMap[h.id]));
  const v = state.successDays[day];
  const note = state.notes[day];
  const future = isFuture(day);

  let html = `<div class="day-modal-tasks">`;
  done.forEach((h) => {
    const v = dayMap[h.id];
    const icon = v === "dash" ? "—" : "✓";
    html += `<div class="day-modal-task done">${icon} ${h.name}</div>`;
  });
  pending.forEach((h) => {
    const v = dayMap[h.id];
    const icon = v === "cross" ? "✕" : "·";
    html += `<div class="day-modal-task pending">${icon} ${h.name}</div>`;
  });
  html += `</div>`;

  if (note) {
    html += `<div class="day-modal-note">${note}</div>`;
  }

  if (!future) {
    html += `<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Day verdict</div>`;
    html += `<div class="day-modal-status">
      <button class="status-btn ${v === "success" ? "active-succ" : ""}"
        onclick="setDayVerdict(${day},'success')">✓ Successful</button>
      <button class="status-btn ${v === "fail" ? "active-fail" : ""}"
        onclick="setDayVerdict(${day},'fail')">✕ Failed</button>
    </div>`;
    html += `<div style="margin-top:12px">
      <button class="btn-ghost" onclick="openNote(${day});closeModal('dayModal')">
        ${note ? "✎ Edit Note" : "+ Add Note"}
      </button>
    </div>`;
  }

  document.getElementById("dayModalContent").innerHTML = html;
  openModal("dayModal");
}

function setDayVerdict(day, verdict) {
  const cur = state.successDays[day];
  if (cur === verdict) delete state.successDays[day];
  else state.successDays[day] = verdict;
  scheduleSave();
  renderStats();
  renderProgressView();
  openDayModal(day); // refresh
  // Also update grid row
  const gridBtn = document.querySelector(
    `.row-succ .daybtn:nth-of-type(${day})`
  );
  // Easier to just rebuild grid
  renderGridBody();
}

// ── NAV ───────────────────────────────────────────────────────────────────────

function changeViewMonth(offset) {
  let m = viewMonth + offset;
  let y = viewYear;
  if (m < 0) {
    m = 11;
    y -= 1;
  }
  if (m > 11) {
    m = 0;
    y += 1;
  }
  viewMonth = m;
  viewYear = y;
  // clamp viewDay
  const dim = DAYS_IN_VIEW();
  if (viewDay > dim) viewDay = dim;
  subscribeToMonth(viewYear, viewMonth);
  render();
}

function prevMonth() {
  changeViewMonth(-1);
}
function nextMonth() {
  changeViewMonth(1);
}

function prevDay() {
  viewDay = Math.max(1, viewDay - 1);
  render();
}
function nextDay() {
  viewDay = Math.min(DAYS_IN_VIEW(), viewDay + 1);
  render();
}
function goToToday() {
  viewYear = CURRENT_YEAR;
  viewMonth = CURRENT_MONTH;
  viewDay = CURRENT_DAY;
  subscribeToMonth(viewYear, viewMonth);
  render();
}

function showView(name) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
  document.getElementById("nav-" + name).classList.add("active");
  if (name === "progress") renderProgressView();
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("mobileBackdrop");
  // On small screens, open as overlay drawer
  if (window.innerWidth <= 640) {
    const open = sidebar.classList.toggle("mobile-open");
    if (backdrop) backdrop.classList.toggle("hidden", !open);
    document.body.style.overflow = open ? "hidden" : "";
    return;
  }
  // Desktop: collapse/expand
  sidebar.classList.toggle("collapsed");
}

// ── MODALS ────────────────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    e.target.classList.add("hidden");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document
      .querySelectorAll(".modal-overlay:not(.hidden)")
      .forEach((m) => m.classList.add("hidden"));
  }
});

// ── RESET ─────────────────────────────────────────────────────────────────────

async function confirmReset() {
  if (
    !confirm(
      `Reset all data for ${MONTH_NAMES[viewMonth]} ${viewYear}? This cannot be undone.`
    )
  )
    return;
  state.checks = {};
  state.successDays = {};
  state.notes = {};
  // Keep `monthNote` and habits intact
  await flushSave();
  render();
}

// ── CHANGE DB ─────────────────────────────────────────────────────────────────

function changeFirebase() {
  if (
    !confirm(
      "Disconnect from current Firebase? You'll need to re-enter your config."
    )
  )
    return;
  localStorage.removeItem(FB_CONFIG_KEY);
  if (unsubscribe) unsubscribe();
  location.reload();
}

// ── SYNC STATUS ───────────────────────────────────────────────────────────────

function setSyncStatus(status) {
  const dot = document.querySelector(".sync-dot");
  const lbl = document.querySelector(".sync-label");
  if (!dot || !lbl) return;
  dot.className =
    "sync-dot" +
    (status === "offline" ? " offline" : status === "saving" ? " saving" : "");
  lbl.textContent =
    status === "offline"
      ? "Offline"
      : status === "saving"
      ? "Saving…"
      : "Synced";
}

// ── UTILS ─────────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── EXPOSE GLOBALS ────────────────────────────────────────────────────────────

Object.assign(window, {
  connectFirebase,
  confirmReset,
  changeFirebase,
  showView,
  toggleSidebar,
  toggleCheck,
  cycleDay,
  openNote,
  saveNote,
  openMonthNote,
  openAddHabit,
  openEditHabit,
  saveHabit,
  deleteHabit,
  dragStart,
  dragOver,
  drop,
  openDayModal,
  setDayVerdict,
  openModal,
  closeModal,
  prevMonth,
  nextMonth,
  prevDay,
  nextDay,
  goToToday,
});

// ── START ─────────────────────────────────────────────────────────────────────

boot();
