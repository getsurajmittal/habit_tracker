// ── FIREBASE DYNAMIC IMPORT ────────────────────────────────────────────────────

const FB_CONFIG_KEY = 'tracker_fb_config';

let db = null;
let MONTH_DOC_ID = '';
let unsubscribe = null;

// Live state from Firestore
let state = {
  habits: [],       // [{id, name, cat, order}]
  checks: {},       // {day: {habitId: bool}}
  successDays: {},  // {day: 'success'|'fail'}
  notes: {}         // {day: string}
};

const TODAY = new Date();
const YEAR = TODAY.getFullYear();
const MONTH = TODAY.getMonth();
const TODAY_DAY = TODAY.getDate();
const DAYS_IN_MONTH = new Date(YEAR, MONTH + 1, 0).getDate();
const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

// ── BOOT ─────────────────────────────────────────────────────────────────────

async function boot() {
  const saved = localStorage.getItem(FB_CONFIG_KEY);
  if (saved) {
    try {
      await initFirebase(JSON.parse(saved));
      return;
    } catch(e) {
      localStorage.removeItem(FB_CONFIG_KEY);
    }
  }
  showSetup();
}

function showSetup() {
  document.getElementById('setupScreen').classList.remove('hidden');
}

async function connectFirebase() {
  const raw = document.getElementById('firebaseConfigInput').value.trim();
  const errEl = document.getElementById('setupError');
  errEl.classList.add('hidden');

  let config;
  try { config = JSON.parse(raw); }
  catch {
    showError(errEl, 'Invalid JSON. Paste the config object from Firebase console.');
    return;
  }
  if (!config.projectId || !config.apiKey) {
    showError(errEl, 'Config is missing projectId or apiKey.');
    return;
  }

  try {
    await initFirebase(config);
    localStorage.setItem(FB_CONFIG_KEY, JSON.stringify(config));
  } catch(e) {
    showError(errEl, 'Could not connect: ' + e.message);
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function initFirebase(config) {
  // Dynamically import Firebase
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const { getFirestore, doc, onSnapshot, setDoc, getDoc } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

  const app = initializeApp(config, config.projectId); // unique name prevents re-init error
  db = getFirestore(app);

  MONTH_DOC_ID = `${YEAR}-${String(MONTH+1).padStart(2,'0')}`;

  // Show app, hide setup
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Load or create month doc
  const monthRef = doc(db, 'tracker', MONTH_DOC_ID);

  // Real-time listener
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(monthRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      state.checks = data.checks || {};
      state.successDays = data.successDays || {};
      state.notes = data.notes || {};
    }
    render();
    setSyncStatus('synced');
  }, (err) => {
    console.error(err);
    setSyncStatus('offline');
  });

  // Load habits from separate doc (persist across months)
  const habitsRef = doc(db, 'tracker', 'habits');
  const habitsSnap = await getDoc(habitsRef);
  if (habitsSnap.exists()) {
    state.habits = habitsSnap.data().list || [];
  } else {
    // First-time: seed default habits
    state.habits = DEFAULT_HABITS.map((h, i) => ({ ...h, id: uid(), order: i }));
    await setDoc(habitsRef, { list: state.habits });
  }

  // Real-time habits listener
  onSnapshot(habitsRef, (snap) => {
    if (snap.exists()) {
      state.habits = (snap.data().list || []).sort((a,b) => a.order - b.order);
      render();
    }
  });

  render();
}

// ── DEFAULT HABITS ────────────────────────────────────────────────────────────

const DEFAULT_HABITS = [
  {name:'Wake up',           cat:'Morning'},
  {name:'Freshen up',        cat:'Morning'},
  {name:'Black coffee',      cat:'Morning'},
  {name:'Chyawanprash',      cat:'Morning'},
  {name:'Handgripper',       cat:'Morning'},
  {name:'Hair repair serum', cat:'Morning'},
  {name:'Hair oil',          cat:'Morning'},
  {name:'Shower',            cat:'Morning'},
  {name:'Facecare',          cat:'Morning'},
  {name:'Minoxidil',         cat:'Morning'},
  {name:'Pooja',             cat:'Morning'},
  {name:'Breakfast',         cat:'Morning'},
  {name:'Fat burner (AM)',   cat:'Health'},
  {name:'Office',            cat:'Work'},
  {name:'Lunch',             cat:'Health'},
  {name:'Fat burner (PM)',   cat:'Health'},
  {name:'Gym/Walk',          cat:'Health'},
  {name:'Shower (Shampoo)',  cat:'Evening'},
  {name:'Multivitamin',      cat:'Evening'},
  {name:'Dinner',            cat:'Evening'},
  {name:'Fat burner (Night)',cat:'Evening'},
  {name:'Facecare (PM)',     cat:'Evening'},
  {name:'Minoxidil (PM)',    cat:'Evening'},
];

// ── SAVE TO FIRESTORE ─────────────────────────────────────────────────────────

let saveTimer = null;
function scheduleSave() {
  setSyncStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

async function flushSave() {
  if (!db) return;
  const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const monthRef = doc(db, 'tracker', MONTH_DOC_ID);
  await setDoc(monthRef, {
    checks: state.checks,
    successDays: state.successDays,
    notes: state.notes,
    year: YEAR,
    month: MONTH + 1,
    updatedAt: Date.now()
  });
}

async function saveHabits() {
  if (!db) return;
  const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  await setDoc(doc(db, 'tracker', 'habits'), { list: state.habits });
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
  const label = `${MONTH_NAMES[MONTH]} ${YEAR}`;
  document.getElementById('sidebarMonth').textContent = label;
  document.getElementById('gridMonth').textContent = label;
  document.getElementById('progressMonth').textContent = label;
}

// ── GRID ──────────────────────────────────────────────────────────────────────

function renderGrid() {
  renderGridHead();
  renderGridBody();
}

function renderGridHead() {
  let html = `<tr>
    <th class="th-task">Habit</th>`;
  for (let d = 1; d <= DAYS_IN_MONTH; d++) {
    html += `<th class="${d === TODAY_DAY ? 'th-today' : ''}">${d}</th>`;
  }
  html += `<th class="th-pct">%</th></tr>`;
  document.getElementById('hthead').innerHTML = html;
}

function renderGridBody() {
  const habits = state.habits;
  if (!habits.length) {
    document.getElementById('htbody').innerHTML =
      `<tr><td colspan="${DAYS_IN_MONTH+2}" style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px">
        No habits yet — add some in the Habits tab.
      </td></tr>`;
    return;
  }

  // Group by category
  const catMap = {};
  habits.forEach(h => {
    const c = h.cat || 'General';
    if (!catMap[c]) catMap[c] = [];
    catMap[c].push(h);
  });

  let html = '';
  Object.entries(catMap).forEach(([cat, catHabits]) => {
    // Section row
    html += `<tr class="row-section">
      <td class="section-name" colspan="${DAYS_IN_MONTH+2}">${cat}</td>
    </tr>`;

    catHabits.forEach(habit => {
      const tid = habit.id;
      html += `<tr>`;
      html += `<td class="td-task">${habit.name}</td>`;

      let doneCount = 0;
      for (let d = 1; d <= DAYS_IN_MONTH; d++) {
        const checked = state.checks[d]?.[tid];
        const future = d > TODAY_DAY;
        if (checked && d <= TODAY_DAY) doneCount++;
        html += `<td>
          <button class="chk ${checked ? 'checked' : ''} ${future ? 'future' : ''}"
            onclick="toggleCheck(${d},'${tid}',this)"
            title="${habit.name} — Day ${d}">${checked ? '✓' : ''}</button>
        </td>`;
      }
      const pct = TODAY_DAY > 0 ? Math.round(doneCount / TODAY_DAY * 100) : 0;
      html += `<td class="td-pct">${pct}%</td></tr>`;
    });
  });

  // ── Successful Day row ──
  html += `<tr class="row-section"><td class="section-name" colspan="${DAYS_IN_MONTH+2}">Daily Verdict</td></tr>`;
  html += `<tr class="row-succ">
    <td class="td-task" style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--green)">✦ Successful Day</td>`;
  for (let d = 1; d <= DAYS_IN_MONTH; d++) {
    const v = state.successDays[d];
    const future = d > TODAY_DAY;
    let cls = future ? 'future' : '';
    let icon = '·';
    if (v === 'success') { cls += ' success'; icon = '✓'; }
    if (v === 'fail')    { cls += ' fail';    icon = '✕'; }
    html += `<td><button class="daybtn ${cls}"
      onclick="cycleDay(${d},this)" title="Day ${d}">${icon}</button></td>`;
  }
  html += `<td></td></tr>`;

  // ── Notes row ──
  html += `<tr class="row-note">
    <td class="td-task" style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--purple)">✎ Notes</td>`;
  for (let d = 1; d <= DAYS_IN_MONTH; d++) {
    const has = !!state.notes[d];
    const future = d > TODAY_DAY;
    html += `<td><button class="notebtn ${has ? 'has-note' : ''} ${future ? 'future' : ''}"
      onclick="openNote(${d})" title="${has ? 'View/edit note' : 'Add note'}">✎</button></td>`;
  }
  html += `<td></td></tr>`;

  document.getElementById('htbody').innerHTML = html;
}

// ── INTERACTIONS ──────────────────────────────────────────────────────────────

function toggleCheck(day, habitId, btn) {
  if (!state.checks[day]) state.checks[day] = {};
  const cur = state.checks[day][habitId];
  state.checks[day][habitId] = !cur;
  btn.classList.toggle('checked', !cur);
  btn.textContent = !cur ? '✓' : '';
  renderStats();
  scheduleSave();
}

function cycleDay(day, btn) {
  if (day > TODAY_DAY) return;
  const cur = state.successDays[day];
  const next = !cur ? 'success' : cur === 'success' ? 'fail' : undefined;
  if (next) state.successDays[day] = next;
  else delete state.successDays[day];

  btn.className = 'daybtn' + (day > TODAY_DAY ? ' future' : '');
  if (next === 'success') { btn.classList.add('success'); btn.textContent = '✓'; }
  else if (next === 'fail') { btn.classList.add('fail'); btn.textContent = '✕'; }
  else btn.textContent = '·';

  renderStats();
  renderProgressView();
  scheduleSave();
}

// ── NOTES ─────────────────────────────────────────────────────────────────────

let activeNoteDay = null;
function openNote(day) {
  if (day > TODAY_DAY) return;
  activeNoteDay = day;
  document.getElementById('noteModalTitle').textContent =
    `Notes — ${MONTH_NAMES[MONTH]} ${day}`;
  document.getElementById('noteText').value = state.notes[day] || '';
  openModal('noteModal');
  setTimeout(() => document.getElementById('noteText').focus(), 60);
}

function saveNote() {
  if (!activeNoteDay) return;
  const v = document.getElementById('noteText').value.trim();
  if (v) state.notes[activeNoteDay] = v;
  else delete state.notes[activeNoteDay];
  closeModal('noteModal');
  renderGrid();
  renderProgressView();
  scheduleSave();
}

// ── HABIT CRUD ────────────────────────────────────────────────────────────────

let editingHabitId = null;

function openAddHabit() {
  editingHabitId = null;
  document.getElementById('habitModalTitle').textContent = 'Add Habit';
  document.getElementById('habitNameInput').value = '';
  document.getElementById('habitCatInput').value = '';
  document.getElementById('habitModalError').classList.add('hidden');
  openModal('habitModal');
  setTimeout(() => document.getElementById('habitNameInput').focus(), 60);
}

function openEditHabit(id) {
  const h = state.habits.find(x => x.id === id);
  if (!h) return;
  editingHabitId = id;
  document.getElementById('habitModalTitle').textContent = 'Edit Habit';
  document.getElementById('habitNameInput').value = h.name;
  document.getElementById('habitCatInput').value = h.cat || '';
  document.getElementById('habitModalError').classList.add('hidden');
  openModal('habitModal');
  setTimeout(() => document.getElementById('habitNameInput').focus(), 60);
}

async function saveHabit() {
  const name = document.getElementById('habitNameInput').value.trim();
  const cat  = document.getElementById('habitCatInput').value.trim();
  const errEl = document.getElementById('habitModalError');

  if (!name) {
    showError(errEl, 'Habit name is required.');
    return;
  }

  if (editingHabitId) {
    const h = state.habits.find(x => x.id === editingHabitId);
    if (h) { h.name = name; h.cat = cat; }
  } else {
    state.habits.push({
      id: uid(),
      name,
      cat,
      order: state.habits.length
    });
  }

  closeModal('habitModal');
  await saveHabits();
  render();
}

async function deleteHabit(id) {
  if (!confirm('Delete this habit? Your check data for it will remain stored but won\'t appear.')) return;
  state.habits = state.habits.filter(h => h.id !== id);
  // Renumber
  state.habits.forEach((h, i) => h.order = i);
  await saveHabits();
  render();
}

// Drag to reorder
let dragId = null;
function dragStart(id) { dragId = id; }
function dragOver(e, id) {
  e.preventDefault();
  document.querySelectorAll('.habit-item').forEach(el => el.classList.remove('drag-over'));
  const el = document.querySelector(`[data-habit-id="${id}"]`);
  if (el) el.classList.add('drag-over');
}
async function drop(id) {
  document.querySelectorAll('.habit-item').forEach(el => el.classList.remove('drag-over'));
  if (!dragId || dragId === id) return;
  const fromIdx = state.habits.findIndex(h => h.id === dragId);
  const toIdx   = state.habits.findIndex(h => h.id === id);
  if (fromIdx < 0 || toIdx < 0) return;
  const [item] = state.habits.splice(fromIdx, 1);
  state.habits.splice(toIdx, 0, item);
  state.habits.forEach((h, i) => h.order = i);
  dragId = null;
  await saveHabits();
  render();
}

// ── RENDER HABITS LIST ────────────────────────────────────────────────────────

function renderHabitsList() {
  const el = document.getElementById('habitsList');
  if (!state.habits.length) {
    el.innerHTML = `<div class="habit-empty">No habits yet.<br>Click <strong>+ Add Habit</strong> to get started.</div>`;
    return;
  }
  el.innerHTML = state.habits.map(h => `
    <div class="habit-item" data-habit-id="${h.id}"
      draggable="true"
      ondragstart="dragStart('${h.id}')"
      ondragover="dragOver(event,'${h.id}')"
      ondrop="drop('${h.id}')">
      <div class="habit-item-left">
        <span class="habit-drag">⠿</span>
        <span class="habit-name">${h.name}</span>
        ${h.cat ? `<span class="habit-cat">${h.cat}</span>` : ''}
      </div>
      <div class="habit-actions">
        <button class="habit-btn" onclick="openEditHabit('${h.id}')" title="Edit">✎</button>
        <button class="habit-btn del" onclick="deleteHabit('${h.id}')" title="Delete">✕</button>
      </div>
    </div>`).join('');
}

// ── STATS ─────────────────────────────────────────────────────────────────────

function renderStats() {
  const habits = state.habits;
  const n = habits.length;

  // Today
  const todayMap = state.checks[TODAY_DAY] || {};
  const todayDone = habits.filter(h => todayMap[h.id]).length;
  document.getElementById('hToday').textContent = `${todayDone}/${n}`;

  // Success days
  const succDays = Object.values(state.successDays).filter(v => v === 'success').length;
  document.getElementById('hSucc').textContent = succDays;

  // Streak
  let streak = 0;
  for (let d = TODAY_DAY; d >= 1; d--) {
    if (state.successDays[d] === 'success') streak++;
    else break;
  }
  document.getElementById('hStreak').textContent = streak;
}

// ── PROGRESS VIEW ─────────────────────────────────────────────────────────────

function renderProgress() {
  renderProgressView();
}

function renderProgressView() {
  const habits = state.habits;
  const n = habits.length;
  if (!n) return;

  // Month bar
  const mPct = Math.round(TODAY_DAY / DAYS_IN_MONTH * 100);
  document.getElementById('monthFill').style.width = mPct + '%';
  document.getElementById('dayProgress').textContent = `Day ${TODAY_DAY} of ${DAYS_IN_MONTH}`;
  document.getElementById('monthPct').textContent = mPct + '%';

  // Overall
  let total = 0, done = 0;
  for (let d = 1; d <= TODAY_DAY; d++) {
    const dm = state.checks[d] || {};
    habits.forEach(h => {
      total++;
      if (dm[h.id]) done++;
    });
  }
  const overallPct = total ? Math.round(done/total*100) : 0;
  document.getElementById('pOverall').textContent = overallPct + '%';
  document.getElementById('pOverallBar').style.width = overallPct + '%';

  // Today
  const todayMap = state.checks[TODAY_DAY] || {};
  const todayDone = habits.filter(h => todayMap[h.id]).length;
  const todayPct = n ? Math.round(todayDone/n*100) : 0;
  document.getElementById('pToday').textContent = todayPct + '%';
  document.getElementById('pTodayBar').style.width = todayPct + '%';

  // Success / fail / unmarked
  const succDays = Object.values(state.successDays).filter(v=>v==='success').length;
  const failDays = Object.values(state.successDays).filter(v=>v==='fail').length;
  const unmarked = TODAY_DAY - succDays - failDays;
  document.getElementById('pSuccDays').textContent = succDays;
  document.getElementById('pSuccSub').textContent = `of ${TODAY_DAY} days passed`;
  document.getElementById('pFailDays').textContent = failDays;
  document.getElementById('pUnmarked').textContent = Math.max(0, unmarked);

  // Streak
  let streak = 0, bestStreak = 0, cur = 0;
  for (let d = TODAY_DAY; d >= 1; d--) {
    if (state.successDays[d] === 'success') streak++;
    else break;
  }
  for (let d = 1; d <= TODAY_DAY; d++) {
    if (state.successDays[d] === 'success') { cur++; bestStreak = Math.max(bestStreak, cur); }
    else cur = 0;
  }
  document.getElementById('pStreak').textContent = streak;
  document.getElementById('pBestStreak').textContent = `Best: ${bestStreak} day${bestStreak!==1?'s':''}`;

  // Heatmap
  let hmHtml = '';
  for (let d = 1; d <= DAYS_IN_MONTH; d++) {
    const v = state.successDays[d];
    const future = d > TODAY_DAY;
    const hasNote = !!state.notes[d];
    let cls = '';
    if (future) cls = 'future-hm';
    else if (v === 'success') cls = 'succ';
    else if (v === 'fail') cls = 'fail';
    if (d === TODAY_DAY) cls += ' today-hm';
    if (hasNote) cls += ' has-note';
    hmHtml += `<div class="hm-day ${cls}" onclick="openDayModal(${d})" title="Day ${d}">${d}</div>`;
  }
  document.getElementById('heatmap').innerHTML = hmHtml;

  // Per-habit bars
  let barsHtml = '';
  habits.forEach(h => {
    let hdone = 0;
    for (let d = 1; d <= TODAY_DAY; d++) {
      if (state.checks[d]?.[h.id]) hdone++;
    }
    const pct = TODAY_DAY ? Math.round(hdone/TODAY_DAY*100) : 0;
    barsHtml += `<div class="hbar-row">
      <div class="hbar-name" title="${h.name}">${h.name}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%"></div></div>
      <div class="hbar-pct">${pct}%</div>
    </div>`;
  });
  document.getElementById('habitBars').innerHTML = barsHtml;
}

// ── DAY MODAL ─────────────────────────────────────────────────────────────────

function openDayModal(day) {
  document.getElementById('dayModalTitle').textContent =
    `${MONTH_NAMES[MONTH]} ${day}, ${YEAR}`;

  const dayMap = state.checks[day] || {};
  const done = state.habits.filter(h => dayMap[h.id]);
  const pending = state.habits.filter(h => !dayMap[h.id]);
  const v = state.successDays[day];
  const note = state.notes[day];
  const future = day > TODAY_DAY;

  let html = `<div class="day-modal-tasks">`;
  done.forEach(h => {
    html += `<div class="day-modal-task done">✓ ${h.name}</div>`;
  });
  pending.forEach(h => {
    html += `<div class="day-modal-task pending">· ${h.name}</div>`;
  });
  html += `</div>`;

  if (note) {
    html += `<div class="day-modal-note">${note}</div>`;
  }

  if (!future) {
    html += `<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Day verdict</div>`;
    html += `<div class="day-modal-status">
      <button class="status-btn ${v==='success'?'active-succ':''}"
        onclick="setDayVerdict(${day},'success')">✓ Successful</button>
      <button class="status-btn ${v==='fail'?'active-fail':''}"
        onclick="setDayVerdict(${day},'fail')">✕ Failed</button>
    </div>`;
    html += `<div style="margin-top:12px">
      <button class="btn-ghost" onclick="openNote(${day});closeModal('dayModal')">
        ${note ? '✎ Edit Note' : '+ Add Note'}
      </button>
    </div>`;
  }

  document.getElementById('dayModalContent').innerHTML = html;
  openModal('dayModal');
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
  const gridBtn = document.querySelector(`.row-succ .daybtn:nth-of-type(${day})`);
  // Easier to just rebuild grid
  renderGridBody();
}

// ── NAV ───────────────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
  if (name === 'progress') renderProgressView();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ── MODALS ────────────────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
  }
});

// ── RESET ─────────────────────────────────────────────────────────────────────

async function confirmReset() {
  if (!confirm(`Reset all data for ${MONTH_NAMES[MONTH]} ${YEAR}? This cannot be undone.`)) return;
  state.checks = {};
  state.successDays = {};
  state.notes = {};
  await flushSave();
  render();
}

// ── CHANGE DB ─────────────────────────────────────────────────────────────────

function changeFirebase() {
  if (!confirm('Disconnect from current Firebase? You\'ll need to re-enter your config.')) return;
  localStorage.removeItem(FB_CONFIG_KEY);
  if (unsubscribe) unsubscribe();
  location.reload();
}

// ── SYNC STATUS ───────────────────────────────────────────────────────────────

function setSyncStatus(status) {
  const dot = document.querySelector('.sync-dot');
  const lbl = document.querySelector('.sync-label');
  if (!dot || !lbl) return;
  dot.className = 'sync-dot' + (status === 'offline' ? ' offline' : status === 'saving' ? ' saving' : '');
  lbl.textContent = status === 'offline' ? 'Offline' : status === 'saving' ? 'Saving…' : 'Synced';
}

// ── UTILS ─────────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── EXPOSE GLOBALS ────────────────────────────────────────────────────────────

Object.assign(window, {
  connectFirebase, confirmReset, changeFirebase,
  showView, toggleSidebar,
  toggleCheck, cycleDay,
  openNote, saveNote,
  openAddHabit, openEditHabit, saveHabit, deleteHabit,
  dragStart, dragOver, drop,
  openDayModal, setDayVerdict,
  openModal, closeModal,
});

// ── START ─────────────────────────────────────────────────────────────────────

boot();
