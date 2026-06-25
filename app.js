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
  calories: {}, // {day: [{id, food, cal, time}]}
  calorieGoal: 2000, // daily kcal target
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
  updateAIStatus();

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
  if (globalSnap.exists()) {
    state.globalNote = globalSnap.data().monthNote || "";
    state.calorieGoal = globalSnap.data().calorieGoal || 2000;
  }
  onSnap2(globalRef, (snap) => {
    if (snap.exists()) {
      state.globalNote = snap.data().monthNote || "";
      state.calorieGoal = snap.data().calorieGoal || 2000;
    }
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
        state.calories = data.calories || {};
      } else {
        state.checks = {};
        state.successDays = {};
        state.notes = {};
        state.calories = {};
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
    calories: state.calories,
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
  await setDoc(gRef, {
    monthNote: state.globalNote,
    calorieGoal: state.calorieGoal,
  });
}

async function saveHabits() {
  if (!db) return;
  const { doc, setDoc } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
  );
  await setDoc(doc(db, "tracker", "habits"), { list: state.habits });
}

// ── GEMINI AI ─────────────────────────────────────────────────────────────────

const GEMINI_KEY_KEY = "tracker_gemini_key";
const GEMINI_MODEL_KEY = "tracker_gemini_model";

// Queries the user's own model list and picks the best available flash model.
// Result is cached in localStorage so subsequent calls are instant.
async function _resolveGeminiModel(key) {
  const cached = localStorage.getItem(GEMINI_MODEL_KEY);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
        key
      )}&pageSize=100`
    );
    if (!resp.ok) return "gemini-2.0-flash";
    const data = await resp.json();

    const candidates = (data.models || [])
      .filter(
        (m) =>
          m.supportedGenerationMethods?.includes("generateContent") &&
          m.name.includes("flash") &&
          !m.name.includes("thinking") &&
          !m.name.includes("-8b")
      )
      .map((m) => m.name.replace("models/", ""));

    // Sort descending — highest version string first
    candidates.sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" })
    );

    const best = candidates[0] || "gemini-2.0-flash";
    localStorage.setItem(GEMINI_MODEL_KEY, best);
    console.log("[AI] Using model:", best);
    return best;
  } catch {
    return "gemini-2.0-flash";
  }
}

async function callGemini(textPrompt, imageBase64 = null, mimeType = null) {
  const key = localStorage.getItem(GEMINI_KEY_KEY);
  if (!key) throw new Error("No Gemini API key configured.");

  const model = await _resolveGeminiModel(key);

  const parts = [];
  if (imageBase64) {
    parts.push({
      inlineData: { data: imageBase64, mimeType: mimeType || "image/jpeg" },
    });
  }
  parts.push({ text: textPrompt });

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      key
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
      }),
    }
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error ${resp.status}`);
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function parseGeminiJSON(text) {
  // Strip markdown code fences Gemini sometimes wraps around JSON
  return JSON.parse(
    text
      .replace(/```json?\n?/g, "")
      .replace(/```\n?/g, "")
      .trim()
  );
}

async function estimateCaloriesFromText(food) {
  const prompt = `You are a nutrition expert with deep knowledge of Indian and global foods, including restaurant chains, branded products, and home-cooked meals.
Estimate calories for the described food item. The input may be:
- A dish name: "paneer butter masala", "biryani", "Big Mac"
- A brand + item: "Haldiram's Bhujia", "Amul butter", "Nescafe coffee"
- A place + dish: "McDonald's McAloo Tikki", "Domino's margherita slice", "Subway 6-inch veggie"
- A vague description: "thali at dhaba", "chyawanprash", "protein shake"
Use typical Indian household or standard restaurant serving sizes. Give a rough but reasonable estimate.
Reference sizes: 1 chapati ~80 kcal, 1 bowl dal ~150 kcal, 1 tsp chyawanprash ~40 kcal,
1 cup cooked rice ~200 kcal, 1 glass milk ~150 kcal, 1 banana ~90 kcal, 1 egg ~78 kcal.
Return ONLY valid JSON, no markdown, no extra text:
{"calories": 250, "description": "e.g. 1 McAloo Tikki burger (standard)"}

Food: "${food}"`;
  const raw = await callGemini(prompt);
  return parseGeminiJSON(raw);
}

async function estimateCaloriesFromPhoto(base64, mimeType) {
  const prompt = `You are a nutrition expert specializing in Indian cuisine and global foods.
Analyze this food photo. Identify all distinct food items visible and estimate calories for each separately.
Use typical Indian household portions. Be specific about serving size in the description.
Return ONLY a valid JSON array, no markdown, no extra text:
[{"food": "Rice", "calories": 250, "description": "~1 cup cooked basmati rice"}, ...]
If no food is identifiable in the image, return: []`;
  const raw = await callGemini(prompt, base64, mimeType);
  return parseGeminiJSON(raw);
}

// ── AI TEXT SUGGESTION ────────────────────────────────────────────────────────

let aiSuggestionData = null;

// Clears the suggestion chip whenever the user edits the food field.
// AI is only triggered manually via triggerAIFromFoodInput().
function onFoodInputChange() {
  _hideAISuggestion();
}

// Called when user clicks ⚡ button or presses Enter in the food field
function triggerAIFromFoodInput() {
  // If suggestion already showing, accept it
  if (aiSuggestionData) {
    acceptAISuggestion();
    return;
  }
  const food = (document.getElementById("calFoodInput")?.value || "").trim();
  if (!food || food.length < 2) return;
  if (!localStorage.getItem(GEMINI_KEY_KEY)) {
    openAISetup();
    return;
  }
  _fetchAISuggestion(food);
}

async function _fetchAISuggestion(food) {
  _setAILoading(true);
  try {
    const result = await estimateCaloriesFromText(food);
    if (result && result.calories) {
      aiSuggestionData = result;
      _setAILoading(false);
      _showAIChip(result);
    } else {
      _setAILoading(false);
      _showAIError("No estimate returned — try rephrasing");
    }
  } catch (e) {
    _setAILoading(false);
    _showAIError(e.message || "AI request failed");
    console.warn("AI suggestion failed:", e);
  }
}

function _setAILoading(show) {
  const wrap = document.getElementById("aiSuggestion");
  const loading = document.getElementById("aiLoading");
  const chip = document.getElementById("aiChip");
  if (!wrap || !loading || !chip) return;
  if (show) {
    wrap.classList.remove("hidden");
    loading.classList.remove("hidden");
    chip.classList.add("hidden");
  } else {
    loading.classList.add("hidden");
    if (chip.classList.contains("hidden")) wrap.classList.add("hidden");
  }
}

function _showAIChip(result) {
  const wrap = document.getElementById("aiSuggestion");
  const chip = document.getElementById("aiChip");
  const text = document.getElementById("aiChipText");
  if (!wrap || !chip || !text) return;
  // Reset any error styling from a previous error
  text.style.color = "";
  chip.style.borderColor = "";
  text.textContent = `~${result.calories} kcal \u00b7 ${result.description}`;
  wrap.classList.remove("hidden");
  chip.classList.remove("hidden");
}

function _showAIError(msg) {
  const wrap = document.getElementById("aiSuggestion");
  const chip = document.getElementById("aiChip");
  const text = document.getElementById("aiChipText");
  if (!wrap || !chip || !text) return;
  text.style.color = "var(--red)";
  chip.style.borderColor = "rgba(255,95,87,.35)";
  text.textContent = "\u26a0 " + msg;
  wrap.classList.remove("hidden");
  chip.classList.remove("hidden");
}

function _hideAISuggestion() {
  const wrap = document.getElementById("aiSuggestion");
  const loading = document.getElementById("aiLoading");
  const chip = document.getElementById("aiChip");
  if (wrap) wrap.classList.add("hidden");
  if (loading) loading.classList.add("hidden");
  if (chip) chip.classList.add("hidden");
}

function acceptAISuggestion() {
  if (!aiSuggestionData) return;
  document.getElementById("calAmtInput").value = aiSuggestionData.calories;
  aiSuggestionData = null;
  _hideAISuggestion();
  document.getElementById("calAmtInput").focus();
}

function dismissAISuggestion() {
  aiSuggestionData = null;
  _hideAISuggestion();
}

// ── PHOTO UPLOAD ──────────────────────────────────────────────────────────────

let _pendingPhotoEntries = [];

function triggerPhotoUpload() {
  if (!localStorage.getItem(GEMINI_KEY_KEY)) {
    openAISetup();
    return;
  }
  document.getElementById("calPhotoInput").click();
}

async function handlePhotoUpload(event) {
  const file = event.target.files?.[0];
  event.target.value = ""; // reset so same file can be re-selected
  if (!file) return;

  _setPhotoLoading(true);
  try {
    const { base64, mimeType } = await _fileToBase64(file);
    const results = await estimateCaloriesFromPhoto(base64, mimeType);
    if (!Array.isArray(results) || !results.length) {
      alert(
        "Couldn't identify food in the photo. Try better lighting or a closer angle."
      );
      return;
    }
    _showPhotoResults(results);
  } catch (e) {
    console.error("Photo analysis failed:", e);
    alert("Photo analysis failed: " + e.message);
  } finally {
    _setPhotoLoading(false);
  }
}

function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const [, base64] = reader.result.split(",");
      resolve({ base64, mimeType: file.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _setPhotoLoading(loading) {
  const btn = document.querySelector(".cal-photo-btn");
  if (!btn) return;
  btn.textContent = loading ? "\u231b" : "\uD83D\uDCF7";
  btn.disabled = loading;
}

function _showPhotoResults(results) {
  _pendingPhotoEntries = results.map((r) => ({ ...r, selected: true }));

  let html = `<p class="photo-result-hint">AI identified these items from your photo. Adjust calories or deselect anything incorrect before adding.</p>
  <div class="photo-results-list">`;

  results.forEach((item, i) => {
    html += `<div class="photo-result-item">
      <label class="photo-result-check">
        <input type="checkbox" checked onchange="togglePhotoEntry(${i},this.checked)">
        <div class="photo-result-info">
          <div class="photo-result-food">${item.food}</div>
          <div class="photo-result-desc">${item.description}</div>
        </div>
      </label>
      <div class="photo-result-right">
        <input class="form-input cal-num-input" type="number" value="${item.calories}"
          min="1" max="9999" onchange="updatePhotoEntryCalories(${i},this.value)">
        <span class="cal-goal-label">kcal</span>
      </div>
    </div>`;
  });

  html += `</div>`;
  document.getElementById("photoResultContent").innerHTML = html;
  openModal("photoResultModal");
}

function togglePhotoEntry(index, selected) {
  if (_pendingPhotoEntries[index])
    _pendingPhotoEntries[index].selected = selected;
}

function updatePhotoEntryCalories(index, val) {
  if (_pendingPhotoEntries[index])
    _pendingPhotoEntries[index].calories = parseInt(val, 10) || 0;
}

function addPhotoEntries() {
  const toAdd = _pendingPhotoEntries.filter(
    (e) => e.selected && e.calories > 0
  );
  if (!toAdd.length) {
    closeModal("photoResultModal");
    return;
  }

  if (!state.calories[viewDay]) state.calories[viewDay] = [];
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  toAdd.forEach((entry) => {
    state.calories[viewDay].push({
      id: uid(),
      food: entry.food,
      cal: entry.calories,
      time,
    });
  });

  _pendingPhotoEntries = [];
  closeModal("photoResultModal");
  renderCalorieView();
  scheduleSave();
}

// ── AI SETUP ──────────────────────────────────────────────────────────────────

function openAISetup() {
  const existing = localStorage.getItem(GEMINI_KEY_KEY) || "";
  document.getElementById("geminiKeyInput").value = existing;
  document.getElementById("geminiSetupError").classList.add("hidden");
  openModal("aiSetupModal");
  updateAIStatus(); // refresh model display in modal
}

function saveGeminiKey() {
  const key = document.getElementById("geminiKeyInput").value.trim();
  const errEl = document.getElementById("geminiSetupError");
  if (!key) {
    showError(errEl, "Please enter your Gemini API key.");
    return;
  }
  localStorage.setItem(GEMINI_KEY_KEY, key);
  closeModal("aiSetupModal");
  updateAIStatus();
}

function removeGeminiKey() {
  localStorage.removeItem(GEMINI_KEY_KEY);
  localStorage.removeItem(GEMINI_MODEL_KEY);
  const inp = document.getElementById("geminiKeyInput");
  if (inp) inp.value = "";
  updateAIStatus();
  closeModal("aiSetupModal");
}

function updateAIStatus() {
  const hasKey = !!localStorage.getItem(GEMINI_KEY_KEY);
  const model = localStorage.getItem(GEMINI_MODEL_KEY);
  // Show short model label e.g. "2.0-flash" from "gemini-2.0-flash"
  const label = model
    ? model
        .replace(/^gemini-/, "")
        .split("-")
        .slice(0, 2)
        .join("-")
    : "auto";
  document.querySelectorAll("#aiSetupBtn,#aiSetupBtnCal").forEach((btn) => {
    if (!btn) return;
    btn.innerHTML = hasKey ? `&#x26A1; AI: ${label}` : "&#x26A1; AI Setup";
    btn.classList.toggle("ai-active", hasKey);
  });
  // Update model display inside setup modal if it's open
  const modelEl = document.getElementById("geminiModelDisplay");
  if (modelEl) modelEl.textContent = model || "detecting\u2026";
}

// ── CALORIE COUNTER ───────────────────────────────────────────────────────────

function renderCalorieView() {
  const logEl = document.getElementById("calorieLog");
  if (!logEl) return;

  const entries = state.calories[viewDay] || [];
  const total = entries.reduce((sum, e) => sum + (e.cal || 0), 0);
  const goal = state.calorieGoal || 2000;

  // Header stats
  const hCalToday = document.getElementById("hCalToday");
  if (hCalToday) hCalToday.textContent = total;
  const hCalGoal = document.getElementById("hCalGoal");
  if (hCalGoal) hCalGoal.textContent = goal;

  // Goal input — don't overwrite while user is typing
  const goalInput = document.getElementById("calorieGoalInput");
  if (goalInput && document.activeElement !== goalInput) goalInput.value = goal;

  // Progress bar
  const pct = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;
  const barFill = document.getElementById("calorieBarFill");
  if (barFill) {
    barFill.style.width = pct + "%";
    barFill.style.background =
      pct >= 100
        ? "var(--red)"
        : pct >= 80
        ? "var(--amber)"
        : "linear-gradient(90deg,var(--green),#86efac)";
  }
  const pctEl = document.getElementById("caloriePct");
  if (pctEl) pctEl.textContent = pct + "%";

  // Log
  if (!entries.length) {
    logEl.innerHTML = `<div class="cal-empty">No food logged for ${MONTH_NAMES[viewMonth]} ${viewDay}.<br>Add items above to start tracking.</div>`;
    return;
  }

  const colorClass =
    total > goal ? "red" : total >= goal * 0.8 ? "amber" : "green";
  let html = `<div class="cal-total-row">
    <span class="cal-total-label">Total \u2014 ${MONTH_NAMES[viewMonth]} ${viewDay}</span>
    <span class="cal-total-val ${colorClass}">${total} kcal</span>
  </div>`;

  entries
    .slice()
    .reverse()
    .forEach((entry) => {
      html += `<div class="cal-entry">
      <div class="cal-entry-left">
        <div class="cal-entry-food">${entry.food}</div>
        ${entry.time ? `<div class="cal-entry-time">${entry.time}</div>` : ""}
      </div>
      <div class="cal-entry-right">
        <div class="cal-entry-cal">${entry.cal} kcal</div>
        <button class="habit-btn del" onclick="deleteCalorieEntry(${viewDay},'${
        entry.id
      }')" title="Remove">\u2715</button>
      </div>
    </div>`;
    });

  logEl.innerHTML = html;
}

function addCalorieEntry() {
  const foodEl = document.getElementById("calFoodInput");
  const amtEl = document.getElementById("calAmtInput");
  if (!foodEl || !amtEl) return;

  const food = foodEl.value.trim();
  const cal = parseInt(amtEl.value, 10);
  if (!food || !cal || cal <= 0) return;

  if (!state.calories[viewDay]) state.calories[viewDay] = [];
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
  state.calories[viewDay].push({ id: uid(), food, cal, time });

  foodEl.value = "";
  amtEl.value = "";
  aiSuggestionData = null;
  _hideAISuggestion();
  foodEl.focus();

  renderCalorieView();
  scheduleSave();
}

function deleteCalorieEntry(day, id) {
  if (!state.calories[day]) return;
  state.calories[day] = state.calories[day].filter((e) => e.id !== id);
  if (!state.calories[day].length) delete state.calories[day];
  renderCalorieView();
  scheduleSave();
}

async function updateCalorieGoal(val) {
  const goal = parseInt(val, 10);
  if (!goal || goal < 100) return;
  state.calorieGoal = goal;
  renderCalorieView();
  await saveGlobalNote(); // saveGlobalNote now also persists calorieGoal
}

// ── AI CHATBOT ────────────────────────────────────────────────────────────────

let _chatHistory = [];

function _buildCalorieContext() {
  const entries = state.calories[viewDay] || [];
  const total = entries.reduce((s, e) => s + (e.cal || 0), 0);
  const goal = state.calorieGoal || 2000;
  const dateStr = `${MONTH_NAMES[viewMonth]} ${viewDay}, ${viewYear}`;
  let ctx = `Today is ${dateStr}. Daily calorie goal: ${goal} kcal. Consumed so far: ${total} kcal (${Math.round(
    (total / goal) * 100
  )}% of goal). Remaining: ${Math.max(0, goal - total)} kcal.`;
  if (entries.length) {
    ctx += ` Foods logged today: ${entries
      .map((e) => `${e.food} (${e.cal} kcal)`)
      .join(", ")}.`;
  } else {
    ctx += ` No food logged yet today.`;
  }
  return ctx;
}

function _appendChatMessage(role, text) {
  _chatHistory.push({ role, text });
  const log = document.getElementById("chatLog");
  if (!log) return;
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function _setChatThinking(show) {
  const btn = document.getElementById("chatSendBtn");
  const input = document.getElementById("chatInput");
  if (btn) {
    btn.disabled = show;
    btn.textContent = show ? "\u2026" : "\u2191";
  }
  if (input) input.disabled = show;
  if (show) {
    const log = document.getElementById("chatLog");
    if (log) {
      const el = document.createElement("div");
      el.className = "chat-msg ai chat-thinking";
      el.id = "chatThinking";
      el.textContent = "thinking\u2026";
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
    }
  } else {
    const el = document.getElementById("chatThinking");
    if (el) el.remove();
  }
}

async function sendChat() {
  const inputEl = document.getElementById("chatInput");
  if (!inputEl) return;
  const question = inputEl.value.trim();
  if (!question) return;
  if (!localStorage.getItem(GEMINI_KEY_KEY)) {
    openAISetup();
    return;
  }

  inputEl.value = "";
  inputEl.style.height = "auto";
  _appendChatMessage("user", question);
  _setChatThinking(true);

  const tips = document.getElementById("chatQuickTips");
  if (tips) tips.classList.add("hidden");

  try {
    const ctx = _buildCalorieContext();
    const prompt = `You are a friendly, practical health and nutrition assistant inside a personal habit tracker app. Keep replies concise (2-4 sentences). Be non-judgmental and supportive. The user eats Indian and global foods.\n\nContext: ${ctx}\n\nQuestion: ${question}`;
    const reply = await callGemini(prompt);
    _setChatThinking(false);
    _appendChatMessage("ai", reply.trim());
  } catch (e) {
    _setChatThinking(false);
    _appendChatMessage(
      "ai",
      "\u26a0 Could not reach AI \u2014 check your Gemini key in AI Setup."
    );
    console.warn("Chat error:", e);
  }
}

function sendQuickChat(question) {
  const inputEl = document.getElementById("chatInput");
  if (inputEl) {
    inputEl.value = question;
    inputEl.style.height = "auto";
  }
  sendChat();
}

function toggleChat() {
  const panel = document.getElementById("chatPanel");
  const fab = document.getElementById("chatFab");
  if (!panel || !fab) return;
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  fab.classList.toggle("open", opening);
  if (opening) {
    setTimeout(() => document.getElementById("chatInput")?.focus(), 80);
  }
}

function clearChat() {
  _chatHistory = [];
  const log = document.getElementById("chatLog");
  if (log) log.innerHTML = "";
  const tips = document.getElementById("chatQuickTips");
  if (tips) tips.classList.remove("hidden");
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function render() {
  renderLabels();
  renderGrid();
  renderProgress();
  renderHabitsList();
  renderStats();
  renderCalorieView();
  renderNotesView();
}

function renderLabels() {
  const label = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
  document.getElementById("sidebarMonth").textContent = label;
  document.getElementById(
    "gridMonth"
  ).textContent = `${MONTH_NAMES[viewMonth]} ${viewDay}, ${viewYear}`;
  document.getElementById("progressMonth").textContent = label;
  const calEl = document.getElementById("calorieMonth");
  if (calEl)
    calEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewDay}, ${viewYear}`;
  const notesMonthEl = document.getElementById("notesMonth");
  if (notesMonthEl) notesMonthEl.textContent = label;
}

// ── GRID ──────────────────────────────────────────────────────────────────────

function renderGrid() {
  renderGridHead();
  renderGridBody();
  renderVerdictBar();
  renderDayNoteBanner();
}

function renderVerdictBar() {
  const bar = document.getElementById("verdictBar");
  if (!bar) return;
  const dim = DAYS_IN_VIEW();
  const days = singleDayView
    ? [viewDay]
    : Array.from({ length: dim }, (_, i) => i + 1);

  let html = `<span class="vbar-label">✦ Successful Day</span><div class="vbar-btns">`;
  days.forEach((d) => {
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
    html += `<button class="daybtn ${cls}" onclick="cycleDay(${d},this)" title="Day ${d}">${icon}</button>`;
  });
  html += `</div>`;
  bar.innerHTML = html;
}

function renderDayNoteBanner() {
  const banner = document.getElementById("dayNoteBanner");
  if (!banner) return;
  if (!singleDayView) {
    banner.classList.add("hidden");
    return;
  }
  const note = state.notes[viewDay];
  const dateStr = `${MONTH_NAMES[viewMonth]} ${viewDay}`;
  const fut = isFuture(viewDay);
  if (note) {
    banner.className = "day-note-banner dnb-has-note";
    banner.innerHTML = `<div class="dnb-label">${
      fut ? "\u270e Plan" : "\u270e Note"
    } \u2014 ${dateStr}</div><div class="dnb-text">${note
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(
        /\n/g,
        "<br>"
      )}</div><button class="dnb-edit" onclick="openNote(${viewDay})">Edit</button>`;
  } else {
    banner.className = "day-note-banner dnb-empty";
    banner.innerHTML = `<button class="dnb-add" onclick="openNote(${viewDay})">${
      fut ? "\u270e Add a plan for" : "\u270e Add a note for"
    } ${dateStr}</button>`;
  }
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
  html += `</tr>`;
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
      days.length + 1
    }" style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px">
        No habits yet — add some in the Habits tab.
      </td></tr>`;
    return;
  }

  const dim = DAYS_IN_VIEW();
  const days = singleDayView
    ? [viewDay]
    : Array.from({ length: dim }, (_, i) => i + 1);
  const visibleDays =
    viewYear === CURRENT_YEAR && viewMonth === CURRENT_MONTH
      ? CURRENT_DAY
      : dim;

  // Split: habits marked (tick/cross/dash) for viewDay sink to bottom
  const viewDayMap = state.checks[viewDay] || {};
  const _isMarked = (h) => {
    const v = normalizeCheckValue(viewDayMap[h.id]);
    return v === "tick" || v === "cross" || v === "dash";
  };
  const unmarked = habits.filter((h) => !_isMarked(h));
  const marked = habits.filter((h) => _isMarked(h));

  // Helper: render one habit row
  const habitRow = (habit) => {
    const tid = habit.id;
    let row = `<tr><td class="td-task">${habit.name}`;
    if (habit.cat) row += `<span class="td-cat">${habit.cat}</span>`;
    row += `</td>`;
    days.forEach((d) => {
      const raw = state.checks[d]?.[tid];
      const checked = normalizeCheckValue(raw);
      const future = isFuture(d);
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
      row += `<td><button class="chk ${cls} ${future ? "future" : ""}"
          onclick="toggleCheck(${d},'${tid}',this)"
          title="${habit.name} — Day ${d}">${icon}</button></td>`;
    });
    row += `</tr>`;
    return row;
  };

  // Helper: render category-grouped habits
  const renderGroup = (list) => {
    const catMap = {};
    list.forEach((h) => {
      const c = h.cat || "General";
      if (!catMap[c]) catMap[c] = [];
      catMap[c].push(h);
    });
    return Object.entries(catMap)
      .map(
        ([cat, hs]) =>
          `<tr class="row-section"><td class="section-name" colspan="${
            days.length + 1
          }">${cat}</td></tr>` + hs.map(habitRow).join("")
      )
      .join("");
  };

  let html = "";

  if (unmarked.length === 0 && marked.length > 0) {
    html += `<tr class="row-section"><td class="section-name" style="color:var(--green)" colspan="${
      days.length + 1
    }">✦ All done for today</td></tr>`;
  } else {
    html += renderGroup(unmarked);
  }

  if (marked.length > 0) {
    html += `<tr class="row-section row-done-divider"><td class="section-name" colspan="${
      days.length + 1
    }">✓ Marked today &middot; ${marked.length}</td></tr>`;
    html += marked.map(habitRow).join("");
  }

  // ── Notes row ──
  html += `<tr class="row-note">
    <td class="td-task" style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--purple)">✎ Notes</td>`;
  days.forEach((d) => {
    const has = !!state.notes[d];
    const future = isFuture(d);
    html += `<td class="td-notes"><button data-day="${d}" class="notebtn ${
      has ? "has-note" : ""
    } ${future ? "future" : ""}"
      title="${has ? "View/edit note" : "Add note"}">✎</button></td>`;
  });
  html += `</tr>`;

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
  return v === true || v === "tick" || v === "dash";
}

function normalizeCheckValue(v) {
  if (v === true) return "tick";
  if (v === false || v === null || v === undefined) return undefined;
  return v; // 'tick'|'cross'|'dash' or other stored value
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
  activeMonthNote = false;
  activeMonthHabit = null;
  activeNoteDay = day;
  const label = isFuture(day)
    ? `Plan — ${MONTH_NAMES[viewMonth]} ${day}`
    : `Notes — ${MONTH_NAMES[viewMonth]} ${day}`;
  document.getElementById("noteModalTitle").textContent = label;
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
  renderNotesView();
  scheduleSave();
}

// removed per-habit month note function — now using a single month note

// ── NOTES VIEW ───────────────────────────────────────────────────────────────

let _monthNoteTimer = null;

function onMonthNoteInput() {
  const val = document.getElementById("monthNoteInput")?.value ?? "";
  state.globalNote = val;
  clearTimeout(_monthNoteTimer);
  _monthNoteTimer = setTimeout(() => {
    saveGlobalNote().catch((e) => console.warn("auto-save month note:", e));
  }, 800);
}

function renderNotesView() {
  const notesMonthEl = document.getElementById("notesMonth");
  if (notesMonthEl)
    notesMonthEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  // Sync month note textarea without disturbing active typing
  const textarea = document.getElementById("monthNoteInput");
  if (textarea && document.activeElement !== textarea)
    textarea.value = state.globalNote || "";

  const journal = document.getElementById("notesJournal");
  if (!journal) return;

  const daysIn = DAYS_IN_VIEW();
  const todayDay =
    viewYear === CURRENT_YEAR && viewMonth === CURRENT_MONTH
      ? CURRENT_DAY
      : daysIn;
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let html = "";
  for (let d = daysIn; d >= 1; d--) {
    const note = state.notes[d];
    const isToday =
      viewYear === CURRENT_YEAR &&
      viewMonth === CURRENT_MONTH &&
      d === CURRENT_DAY;
    const fut = d > todayDay;
    const dow = DOW[new Date(viewYear, viewMonth - 1, d).getDay()];
    const safe = note
      ? note
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>")
      : "";

    if (note) {
      html += `<div class="journal-card${isToday ? " today" : ""}">
        <div class="journal-card-head">
          <div class="journal-date">
            <span class="journal-day-num">${d}</span>
            <span class="journal-dow">${dow}</span>
            ${
              isToday
                ? `<span class="journal-chip today-chip">today</span>`
                : ""
            }
            ${fut ? `<span class="journal-chip plan-chip">plan</span>` : ""}
          </div>
          <button class="journal-edit-btn" onclick="openNote(${d})">Edit</button>
        </div>
        <div class="journal-text">${safe}</div>
      </div>`;
    } else {
      html += `<div class="journal-empty${isToday ? " today" : ""}${
        fut ? " future" : ""
      }">
        <span class="journal-day-num dim">${d}</span>
        <span class="journal-dow dim">${dow}</span>
        ${isToday ? `<span class="journal-chip today-chip">today</span>` : ""}
        ${fut ? `<span class="journal-chip plan-chip">plan ahead</span>` : ""}
        <button class="journal-add-btn" onclick="openNote(${d})">+ Add note</button>
      </div>`;
    }
  }
  journal.innerHTML =
    html ||
    `<div class="journal-empty-state">No entries yet. Tap any day to write.</div>`;
}

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

// ── DRAG TO REORDER (Pointer Events — works on touch and mouse) ───────────────

let _dragId = null;
let _dragFromIdx = -1;

function _initHabitDrag() {
  document.querySelectorAll(".habit-drag").forEach((handle) => {
    handle.addEventListener("pointerdown", _dragPointerDown, {
      passive: false,
    });
  });
}

function _dragPointerDown(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  e.preventDefault();

  const item = e.currentTarget.closest(".habit-item");
  if (!item) return;

  _dragId = item.dataset.habitId;
  _dragFromIdx = state.habits.findIndex((h) => h.id === _dragId);
  if (_dragFromIdx < 0) return;

  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch (_) {}

  item.classList.add("dragging");

  document.addEventListener("pointermove", _dragPointerMove, {
    passive: false,
  });
  document.addEventListener("pointerup", _dragPointerUp, { once: true });
  document.addEventListener("pointercancel", _dragCleanup, { once: true });
}

function _dragPointerMove(e) {
  if (!_dragId) return;
  e.preventDefault();

  document
    .querySelectorAll(".habit-item.drag-over")
    .forEach((el) => el.classList.remove("drag-over"));

  const items = Array.from(
    document.querySelectorAll(".habit-item:not(.dragging)")
  );
  for (const el of items) {
    const r = el.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY < r.bottom) {
      el.classList.add("drag-over");
      break;
    }
  }

  // Auto-scroll when near the top or bottom of the list
  const list = document.getElementById("habitsList");
  if (list) {
    const r = list.getBoundingClientRect();
    const edge = 56;
    if (e.clientY - r.top < edge) list.scrollTop -= 6;
    else if (r.bottom - e.clientY < edge) list.scrollTop += 6;
  }
}

async function _dragPointerUp() {
  if (!_dragId) return;
  const target = document.querySelector(".habit-item.drag-over");
  const targetId = target?.dataset.habitId;
  const fromIdx = _dragFromIdx;
  const fromId = _dragId;
  _dragCleanup();

  if (!targetId || targetId === fromId) return;
  const toIdx = state.habits.findIndex((h) => h.id === targetId);
  if (toIdx < 0 || toIdx === fromIdx) return;

  const [moved] = state.habits.splice(fromIdx, 1);
  state.habits.splice(toIdx, 0, moved);
  state.habits.forEach((h, i) => (h.order = i));
  await saveHabits();
  render();
}

function _dragCleanup() {
  document
    .querySelectorAll(".habit-item")
    .forEach((el) => el.classList.remove("dragging", "drag-over"));
  document.removeEventListener("pointermove", _dragPointerMove);
  _dragId = null;
  _dragFromIdx = -1;
}

// Keep old names in window for backward compat — no longer used by HTML
function dragStart() {}
function dragOver() {}
function drop() {}

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
    <div class="habit-item" data-habit-id="${h.id}">
      <div class="habit-item-left">
        <span class="habit-drag" title="Hold &amp; drag to reorder">⠿</span>
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
  _initHabitDrag();
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

  // Calories for the viewed day — shown in grid header
  const calEntries = state.calories[viewDay] || [];
  const calTotal = calEntries.reduce((s, e) => s + (e.cal || 0), 0);
  const calDash = document.getElementById("hCalDash");
  if (calDash) calDash.textContent = calTotal > 0 ? String(calTotal) : "—";
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
  const pTodaySub = document.getElementById("pTodaySub");
  if (pTodaySub) pTodaySub.textContent = `${todayDone} of ${n} habits done`;

  // Success / fail / unmarked
  const succDays = Object.values(state.successDays).filter(
    (v) => v === "success"
  ).length;
  const failDays = Object.values(state.successDays).filter(
    (v) => v === "fail"
  ).length;
  const unmarked = visibleDays - succDays - failDays;
  document.getElementById("pSuccDays").textContent = succDays;
  document.getElementById("pSuccSub").textContent = `of ${visibleDays} days`;
  document.getElementById("pFailDays").textContent = failDays;
  const pUnmarked = document.getElementById("pUnmarked");
  if (pUnmarked) pUnmarked.textContent = Math.max(0, unmarked);

  // Day breakdown stacked bar
  const dbdSuccEl = document.getElementById("dbdSucc");
  if (dbdSuccEl) {
    const succPct = visibleDays ? (succDays / visibleDays) * 100 : 0;
    const failPct = visibleDays ? (failDays / visibleDays) * 100 : 0;
    const unPct = Math.max(0, 100 - succPct - failPct);
    dbdSuccEl.style.width = succPct + "%";
    document.getElementById("dbdFail").style.width = failPct + "%";
    document.getElementById("dbdUnmarked").style.width = unPct + "%";
    document.getElementById(
      "dbdSuccLabel"
    ).textContent = `${succDays} successful`;
    document.getElementById("dbdFailLabel").textContent = `${failDays} failed`;
    document.getElementById("dbdUnmarkedLabel").textContent = `${Math.max(
      0,
      unmarked
    )} unmarked`;
  }

  // Calorie pill
  const calEntries = state.calories[viewDay] || [];
  const calTotal = calEntries.reduce((s, e) => s + (e.cal || 0), 0);
  const calGoal = state.calorieGoal || 2000;
  const pCalTodayEl = document.getElementById("pCalToday");
  const pCalSubEl = document.getElementById("pCalSub");
  if (pCalTodayEl) {
    pCalTodayEl.textContent = calTotal > 0 ? String(calTotal) : "\u2014";
    const ratio = calTotal / calGoal;
    pCalTodayEl.className =
      "ppill-val " +
      (calTotal === 0
        ? "dim"
        : ratio > 1
        ? "red"
        : ratio >= 0.8
        ? "amber"
        : "green");
  }
  if (pCalSubEl) pCalSubEl.textContent = `of ${calGoal} kcal`;

  // Monthly calorie average
  let calDayCount = 0,
    calMonthTotal = 0;
  for (let d = 1; d <= visibleDays; d++) {
    const dayCalSum = (state.calories[d] || []).reduce(
      (s, e) => s + (e.cal || 0),
      0
    );
    if (dayCalSum > 0) {
      calDayCount++;
      calMonthTotal += dayCalSum;
    }
  }
  const calAvg = calDayCount > 0 ? Math.round(calMonthTotal / calDayCount) : 0;
  const pCalAvgEl = document.getElementById("pCalAvg");
  if (pCalAvgEl) pCalAvgEl.textContent = calAvg > 0 ? String(calAvg) : "\u2014";

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
    const dayCalSum = (state.calories[d] || []).reduce(
      (s, e) => s + (e.cal || 0),
      0
    );
    const hasCal = dayCalSum > 0;
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
    if (hasCal) cls += " has-cal";
    const tooltip = future
      ? `Day ${d}`
      : `Day ${d} \u00b7 ${
          v === "success"
            ? "\u2713 Successful"
            : v === "fail"
            ? "\u2717 Failed"
            : "Unmarked"
        }${hasCal ? ` \u00b7 ${dayCalSum}\u202fkcal` : ""}`;
    hmHtml += `<div class="hm-day ${cls}" onclick="openDayModal(${d})" title="${tooltip}">${d}</div>`;
  }
  document.getElementById("heatmap").innerHTML = hmHtml;

  // Per-habit bars — sorted ascending (weakest first) so user sees what needs work
  const habitStats = habits.map((h) => {
    let hdone = 0;
    for (let d = 1; d <= visibleDays; d++) {
      if (isDoneValue(state.checks[d]?.[h.id])) hdone++;
    }
    const pct = visibleDays ? Math.round((hdone / visibleDays) * 100) : 0;
    return { h, hdone, pct };
  });
  habitStats.sort((a, b) => a.pct - b.pct);

  const headEl = document.getElementById("habitBarsHead");
  if (headEl) {
    const allStrong = habitStats.every((s) => s.pct >= 80);
    headEl.innerHTML = allStrong
      ? `<span class="sh-icon">\u2736</span> Habit Performance <span class="section-hint">\u2714 all on track</span>`
      : `<span class="sh-icon">\u2736</span> Habit Performance <span class="section-hint">weakest first, by category</span>`;
  }

  // Group by category, each group sorted ascending by pct, categories sorted by avg pct
  const catMap = {};
  habitStats.forEach((s) => {
    const cat = s.h.cat || "";
    if (!catMap[cat]) catMap[cat] = [];
    catMap[cat].push(s);
  });
  const catGroups = Object.entries(catMap).map(([cat, stats]) => ({
    cat,
    stats: stats.sort((a, b) => a.pct - b.pct),
    avg: Math.round(stats.reduce((sum, x) => sum + x.pct, 0) / stats.length),
  }));
  catGroups.sort((a, b) => a.avg - b.avg);
  const showCatHeads =
    catGroups.length > 1 || (catGroups[0] && catGroups[0].cat !== "");

  let barsHtml = "";
  catGroups.forEach(({ cat, stats, avg }) => {
    if (showCatHeads && cat) {
      const cColor =
        avg < 50 ? "var(--red)" : avg < 80 ? "var(--amber)" : "var(--green)";
      barsHtml += `<div class="hbar-cat-head"><span class="hbar-cat-name">${cat}</span><span class="hbar-cat-avg" style="color:${cColor}">${avg}% avg</span></div>`;
    }
    stats.forEach(({ h, hdone, pct }) => {
      const color =
        pct < 50 ? "var(--red)" : pct < 80 ? "var(--amber)" : "var(--green)";
      barsHtml += `<div class="hbar-row">
        <div class="hbar-name" title="${h.name}">${h.name}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="hbar-meta">
          <span class="hbar-pct" style="color:${color}">${pct}%</span>
          <span class="hbar-count">${hdone}/${visibleDays}d</span>
        </div>
      </div>`;
    });
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
    const vraw = dayMap[h.id];
    const vnorm = normalizeCheckValue(vraw);
    const icon = vnorm === "dash" ? "—" : "✓";
    html += `<div class="day-modal-task done">${icon} ${h.name}</div>`;
  });
  pending.forEach((h) => {
    const vraw = dayMap[h.id];
    const vnorm = normalizeCheckValue(vraw);
    const icon = vnorm === "cross" ? "✕" : "·";
    html += `<div class="day-modal-task pending">${icon} ${h.name}</div>`;
  });
  html += `</div>`;

  if (note) {
    html += `<div class="day-modal-note">${note}</div>`;
  }

  // Calorie summary for the day
  const calEntries = state.calories[day] || [];
  if (calEntries.length) {
    const calTotal = calEntries.reduce((s, e) => s + (e.cal || 0), 0);
    const goal = state.calorieGoal || 2000;
    const calCls =
      calTotal > goal ? "red" : calTotal >= goal * 0.8 ? "amber" : "green";
    html += `<div class="day-modal-cal-summary">
      <span class="day-modal-cal-label">🔥 ${calEntries.length} item${
      calEntries.length !== 1 ? "s" : ""
    } logged</span>
      <span class="day-modal-cal-val ${calCls}">${calTotal} kcal</span>
    </div>`;
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
  dismissAISuggestion();
  render();
}
function nextDay() {
  viewDay = Math.min(DAYS_IN_VIEW(), viewDay + 1);
  dismissAISuggestion();
  render();
}
function goToToday() {
  viewYear = CURRENT_YEAR;
  viewMonth = CURRENT_MONTH;
  viewDay = CURRENT_DAY;
  dismissAISuggestion();
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
  if (name === "calories") renderCalorieView();
  if (name === "notes") renderNotesView();
  // Auto-close sidebar on mobile after selecting a view
  if (window.innerWidth <= 640) {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("mobileBackdrop");
    sidebar.classList.remove("mobile-open");
    if (backdrop) backdrop.classList.add("hidden");
    document.body.style.overflow = "";
  }
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

// Swipe-to-open sidebar on mobile
(function () {
  let _sx = 0,
    _sy = 0;
  document.addEventListener(
    "touchstart",
    (e) => {
      _sx = e.touches[0].clientX;
      _sy = e.touches[0].clientY;
    },
    { passive: true }
  );
  document.addEventListener(
    "touchend",
    (e) => {
      if (!e.changedTouches.length || window.innerWidth > 640) return;
      const dx = e.changedTouches[0].clientX - _sx;
      const dy = e.changedTouches[0].clientY - _sy;
      if (Math.abs(dy) > 80) return; // too vertical
      const sidebar = document.getElementById("sidebar");
      const isOpen = sidebar.classList.contains("mobile-open");
      if (!isOpen && _sx < 32 && dx > 60) toggleSidebar(); // swipe right from edge
      if (isOpen && dx < -60) toggleSidebar(); // swipe left to close
    },
    { passive: true }
  );
})();

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
  onMonthNoteInput,
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
  addCalorieEntry,
  deleteCalorieEntry,
  updateCalorieGoal,
  onFoodInputChange,
  triggerAIFromFoodInput,
  acceptAISuggestion,
  dismissAISuggestion,
  triggerPhotoUpload,
  handlePhotoUpload,
  togglePhotoEntry,
  updatePhotoEntryCalories,
  addPhotoEntries,
  openAISetup,
  saveGeminiKey,
  removeGeminiKey,
  sendChat,
  sendQuickChat,
  toggleChat,
  clearChat,
});

// ── START ─────────────────────────────────────────────────────────────────────

boot();

// Responsive: auto-switch to single-day view on small screens to avoid cramped grid
let _prevSingleDayView = null;
let _autoSingleActive = false;
function updateResponsiveSingleDay() {
  try {
    const small = window.innerWidth <= 640;
    if (small && !_autoSingleActive) {
      _prevSingleDayView = singleDayView;
      singleDayView = true;
      _autoSingleActive = true;
      render();
    } else if (!small && _autoSingleActive) {
      singleDayView = _prevSingleDayView === null ? true : _prevSingleDayView;
      _autoSingleActive = false;
      render();
    }
  } catch (e) {
    console.warn("responsive switch failed", e);
  }
}
window.addEventListener("resize", () => {
  updateResponsiveSingleDay();
});
// run once on load
updateResponsiveSingleDay();
