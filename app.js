// ── FIREBASE DYNAMIC IMPORT ────────────────────────────────────────────────────

const FB_CONFIG_KEY = "tracker_fb_config";

let db = null;
let storage = null;
let MONTH_DOC_ID = "";
let unsubscribe = null;

// Live state from Firestore
let state = {
  habits: [], // [{id, name, cat, order}]
  checks: {}, // {day: {habitId: bool}}
  successDays: {}, // {day: 'success'|'fail'}
  notes: {}, // {day: string}
  calories: {}, // {day: [{id, food, cal, time}]}
  bodyAnalysis: {}, // {day: {summary, focus, note, capturedAt, photoUrl}}
  calorieGoal: 2000, // daily kcal target
  markOrder: {}, // {day: [habitId, ...]} — order habits were first marked
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
const THEME_KEY = "tracker_theme";

// ── BOOT ─────────────────────────────────────────────────────────────────────

async function boot() {
  initTheme();
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
  try {
    const { getStorage } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js"
    );
    storage = getStorage(app);
  } catch (err) {
    console.warn("Firebase Storage not available:", err);
  }
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
        state.bodyAnalysis = data.bodyAnalysis || {};
        state.markOrder = data.markOrder || {};
      } else {
        state.checks = {};
        state.successDays = {};
        state.notes = {};
        state.calories = {};
        state.bodyAnalysis = {};
        state.markOrder = {};
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
    bodyAnalysis: state.bodyAnalysis,
    markOrder: state.markOrder,
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

async function fetchWithTimeout(input, init = {}, timeout = 120000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeout / 1000} seconds.`);
    }
    throw err;
  } finally {
    clearTimeout(id);
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

  const resp = await fetchWithTimeout(
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
    },
    120000
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
{"food": "clean food name e.g. Dal Chawal", "calories": 250, "description": "serving size detail e.g. 1 katori dal + 1 cup rice"}

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

async function estimateBodyAnalysisFromPhoto(base64, mimeType) {
  const prompt = `You are a positive wellness coach and body awareness companion.
Look at the photo and provide a short, encouraging daily check-in summary.
Focus on posture, energy, confidence, and motivation for healthy habits.
Return ONLY valid JSON with these fields:
{"summary": "short supportive summary", "focus": "single focus area", "note": "motivational note"}
If the photo is not clear enough for body analysis, return: {"summary": "", "focus": "", "note": ""}`;
  const raw = await callGemini(prompt, base64, mimeType);
  return parseGeminiJSON(raw);
}

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
  const foodLabel = result.food ? `${result.food} \u2014 ` : "";
  text.textContent = `${foodLabel}~${result.calories}\u202fkcal \u00b7 ${result.description}`;
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
  // Use AI food name (falls back to what user typed)
  const food =
    aiSuggestionData.food ||
    (document.getElementById("calFoodInput")?.value || "").trim() ||
    "Food item";
  const cal = aiSuggestionData.calories;
  if (!food || !cal || cal <= 0) return;

  if (!state.calories[viewDay]) state.calories[viewDay] = [];
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
  state.calories[viewDay].push({ id: uid(), food, cal, time });

  // Clear form fields
  const foodEl = document.getElementById("calFoodInput");
  const amtEl = document.getElementById("calAmtInput");
  if (foodEl) {
    foodEl.value = "";
    foodEl.focus();
  }
  if (amtEl) amtEl.value = "";
  aiSuggestionData = null;
  _hideAISuggestion();

  renderCalorieView();
  scheduleSave();
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
      const dataUrl = reader.result;
      const [, base64] = dataUrl.split(",");
      resolve({ base64, mimeType: file.type, dataUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function _fileToDataURL(file) {
  const { dataUrl } = await _fileToBase64(file);
  return dataUrl;
}

async function _resizeImageForUpload(file, maxWidth = 640, maxHeight = 640, quality = 0.5) {
  const { dataUrl } = await _fileToBase64(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.width;
      const height = img.height;
      const ratio = Math.min(1, maxWidth / width, maxHeight / height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not create canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
      const mimeType = "image/jpeg";
      const base64 = compressedDataUrl.split(",")[1];
      resolve({ dataUrl: compressedDataUrl, base64, mimeType });
    };
    img.onerror = () => reject(new Error("Failed to load image for resizing"));
    img.src = dataUrl;
  });
}

async function uploadBodyPhoto(year, month, day, dataUrl) {
  // Persist the resized image inline to avoid storage permission issues.
  return dataUrl;
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

function triggerBodyPhotoUpload() {
  document.getElementById("bodyPhotoInput").click();
}

async function handleBodyPhotoUpload(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  const indicator = document.getElementById("bodyAnalysisEmpty");
  if (indicator) indicator.textContent = "Saving photo…";

  try {
    const { dataUrl } = await _resizeImageForUpload(file);
    console.log("Body photo resized, storing inline", {
      width: dataUrl.length,
      day: viewDay,
    });

    state.bodyAnalysis[viewDay] = {
      ...(state.bodyAnalysis[viewDay] || {}),
      capturedAt: Date.now(),
      photo: dataUrl,
    };
    scheduleSave();
    renderBodyView();

    if (indicator)
      indicator.textContent = "Photo saved. View your progress below.";
  } catch (e) {
    console.error("Body photo save failed:", e);
    if (indicator)
      indicator.textContent =
        "Could not save photo. Check your Firebase config or try again.";
  }
}

function renderBodyView() {
  const card = document.getElementById("bodyAnalysisCard");
  const empty = document.getElementById("bodyAnalysisEmpty");
  const summaryEl = document.getElementById("bodyAnalysisSummary");
  const focusEl = document.getElementById("bodyAnalysisSuggestion");
  const dateEl = document.getElementById("bodyAnalysisDate");
  const historyEl = document.getElementById("bodyHistory");
  const trackedPercentEl = document.getElementById("bodyTrackedPercent");
  const photoCountEl = document.getElementById("bodyPhotoCount");
  const progressNoteEl = document.getElementById("bodyProgressNote");

  const entries = Object.keys(state.bodyAnalysis || {}).length;
  const today = state.bodyAnalysis[viewDay];
  const photos = Object.values(state.bodyAnalysis || {}).filter(
    (entry) => entry.photo || entry.photoUrl
  );
  const completedDays = photos.length;
  const percent = Math.round((completedDays / Math.max(1, DAYS_IN_VIEW())) * 100);

  if (trackedPercentEl) trackedPercentEl.textContent = `${percent}%`;
  if (photoCountEl) photoCountEl.textContent = `${photos.length}`;
  if (progressNoteEl)
    progressNoteEl.textContent =
      photos.length > 0
        ? "Tap any entry below to review your progress photo and note."
        : "Start capturing daily photos to watch your journey grow.";

  document.getElementById("bodyDaysTracked").textContent = entries;
  document.getElementById("bodyLastFocus").textContent =
    today?.focus || "No entry yet";

  const hasPhoto = today && (today.photoUrl || today.photo);
  if (today && today.summary) {
    if (dateEl) dateEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewDay}`;
    if (summaryEl) summaryEl.textContent = today.summary;
    if (focusEl) focusEl.textContent = `Focus: ${today.focus || "Gentle posture"}`;
    if (card) card.classList.remove("hidden");
    if (empty) empty.classList.add("hidden");
  } else if (hasPhoto) {
    if (dateEl) dateEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewDay}`;
    if (summaryEl) summaryEl.textContent =
      today?.photo
        ? "Photo saved. Tap a block below to expand."
        : "Photo URL saved. Tap a block below to expand.";
    if (focusEl) focusEl.textContent = "Focus: View your check-in photos.";
    if (card) card.classList.remove("hidden");
    if (empty) empty.classList.add("hidden");
  } else {
    if (card) card.classList.add("hidden");
    if (empty) {
      empty.classList.remove("hidden");
      empty.textContent =
        "No body photos yet. Take a photo to track your progress.";
    }
  }

  if (!historyEl) return;
  if (!photos.length) {
    historyEl.innerHTML = `<div class="body-history-empty">No previous body check-ins yet.</div>`;
    return;
  }

  const sorted = Object.entries(state.bodyAnalysis || {})
    .filter(([, entry]) => entry.photo || entry.photoUrl)
    .map(([day, entry]) => ({ day: Number(day), ...entry }))
    .sort((a, b) => b.day - a.day);

  historyEl.innerHTML = sorted
    .map(
      (entry) => {
        const src = entry.photoUrl || entry.photo;
        return `<div class="body-history-entry" onclick="showBodyHistory(${entry.day})">
          <div class="body-history-entry-header">
            <div class="bhead">
              <span class="bday">${MONTH_NAMES[viewMonth]} ${entry.day}</span>
              <span class="bfocus">${entry.focus || "Check-in"}</span>
            </div>
            <button class="body-history-delete" onclick="deleteBodyPhoto(${entry.day}, event)" title="Delete photo">✕</button>
          </div>
          <img src="${src}" alt="Body check-in ${entry.day}" />
        </div>`;
      }
    )
    .join("");
}

function deleteBodyPhoto(day, event) {
  event.stopPropagation();
  if (!confirm(`Delete the photo for ${MONTH_NAMES[viewMonth]} ${day}?`)) return;
  if (!state.bodyAnalysis || !state.bodyAnalysis[day]) return;
  delete state.bodyAnalysis[day].photo;
  delete state.bodyAnalysis[day].photoUrl;
  if (Object.keys(state.bodyAnalysis[day]).length === 0) delete state.bodyAnalysis[day];
  scheduleSave();
  renderBodyView();
}

function showBodyHistory(day) {
  const entry = state.bodyAnalysis[day];
  if (!entry) return;
  const modalContent = document.getElementById("bodyHistoryModalContent");
  if (!modalContent) return;
  const src = entry.photoUrl || entry.photo;
  modalContent.innerHTML = `
    <div class="body-history-modal-date">${MONTH_NAMES[viewMonth]} ${day}</div>
    <img class="body-history-modal-img" src="${src}" alt="Body check-in ${day}" />
    <div class="body-history-modal-summary">${entry.summary}</div>
    <div class="body-history-modal-focus">Focus: ${entry.focus || "Gentle posture"}</div>
    <div class="body-history-modal-note">${entry.note || "Motivation note."}</div>
  `;
  openModal("bodyHistoryModal");
}

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
  renderBodyView();
  renderNotesView();
  renderStatusBanner(); // anti-slip banner
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
  const bodyMonthEl = document.getElementById("bodyMonth");
  if (bodyMonthEl)
    bodyMonthEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewDay}, ${viewYear}`;
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

// ── HABIT SCHEDULING HELPERS ─────────────────────────────────────────────────

// Returns true if the habit should appear on the given date
function isHabitActiveOnDate(habit, year, month, day) {
  // Day-of-week filter (0=Sun … 6=Sat, matches JS Date.getDay)
  if (habit.days && habit.days.length > 0) {
    const dow = new Date(year, month, day).getDay();
    if (!habit.days.includes(dow)) return false;
  }
  // Start date filter
  if (habit.startDate) {
    const d = new Date(year, month, day);
    const sd = new Date(habit.startDate + "T00:00:00");
    if (d < sd) return false;
  }
  // End date filter
  if (habit.endDate) {
    const d = new Date(year, month, day);
    const ed = new Date(habit.endDate + "T00:00:00");
    if (d > ed) return false;
  }
  return true;
}

function toggleDowBtn(btn) {
  btn.classList.toggle("active");
}

function setHabitDaysUI(days) {
  document.querySelectorAll("#habitDowToggles .dow-btn").forEach((btn) => {
    btn.classList.toggle(
      "active",
      !!(days && days.includes(parseInt(btn.dataset.dow)))
    );
  });
}

function getSelectedHabitDays() {
  const active = [];
  document
    .querySelectorAll("#habitDowToggles .dow-btn.active")
    .forEach((btn) => {
      active.push(parseInt(btn.dataset.dow));
    });
  return active.length === 0 || active.length === 7 ? null : active;
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
  // In single-day view only show habits scheduled for that day
  const sourceHabits = singleDayView
    ? habits.filter((h) => isHabitActiveOnDate(h, viewYear, viewMonth, viewDay))
    : habits;
  const unmarked = sourceHabits.filter((h) => !_isMarked(h));
  // Sort marked habits by the order they were first marked (not drag order)
  const _markOrderDay = state.markOrder?.[viewDay] || [];
  const marked = sourceHabits
    .filter((h) => _isMarked(h))
    .sort((a, b) => {
      const ai = _markOrderDay.indexOf(a.id);
      const bi = _markOrderDay.indexOf(b.id);
      return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
    });

  // Helper: render one habit row
  const habitRow = (habit) => {
    const tid = habit.id;
    let row = `<tr><td class="td-task">${habit.name}</td>`;
    days.forEach((d) => {
      if (!isHabitActiveOnDate(habit, viewYear, viewMonth, d)) {
        row += `<td class="td-inactive" title="Not scheduled"></td>`;
        return;
      }
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

  let html = "";

  if (unmarked.length === 0 && marked.length > 0) {
    html += `<tr class="row-section"><td class="section-name" style="color:var(--green)" colspan="${
      days.length + 1
    }">✦ All done for today</td></tr>`;
  } else {
    html += unmarked.map(habitRow).join("");
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

  // Track marking order: append on first mark, remove on unmark
  if (!cur && next) {
    // transitioning unmarked → marked for the first time
    if (!state.markOrder[day]) state.markOrder[day] = [];
    if (!state.markOrder[day].includes(habitId))
      state.markOrder[day].push(habitId);
  } else if (!next) {
    // transitioning marked → unmarked
    if (state.markOrder[day]) {
      state.markOrder[day] = state.markOrder[day].filter(
        (id) => id !== habitId
      );
    }
  }

  // update button appearance
  btn.classList.remove("tick", "cross", "dash");
  if (next) btn.classList.add(next);
  const icon =
    next === "tick" ? "✓" : next === "cross" ? "✕" : next === "dash" ? "—" : "";
  btn.textContent = icon;

  renderStats();
  renderStatusBanner();
  scheduleSave();
}

function cycleDay(day, btn) {
  if (isFuture(day)) return;
  const cur = state.successDays[day];
  // If cycling to "fail" and there's an active streak, require confirmation
  if (!cur && _computeCurrentStreak() > 0) {
    // Going from unmarked -> success first click: no issue
    // Actually cycle goes: none->success->fail->none
    // So first click = success, never hits fail on first click
  }
  const next = !cur ? 'success' : cur === 'success' ? 'fail' : undefined;

  // Streak protection: intercept when trying to mark fail on today with a streak
  const isToday = viewYear === CURRENT_YEAR && viewMonth === CURRENT_MONTH && day === CURRENT_DAY;
  if (next === 'fail' && isToday) {
    const streak = _computeCurrentStreak();
    if (streak > 0) {
      // Show confirmation modal instead of immediately cycling
      _pendingCycleDayArgs = { day, btn, next };
      const numEl = document.getElementById('streakConfirmNum');
      const unitEl = document.getElementById('streakConfirmUnit');
      const msgEl = document.getElementById('streakConfirmMsg');
      const confirmBtn = document.getElementById('streakConfirmBtn');
      if (numEl) numEl.textContent = streak;
      if (unitEl) unitEl.textContent = `day${streak !== 1 ? 's' : ''} at stake`;
      if (msgEl) msgEl.textContent = `You have a ${streak}-day streak. Marking today as failed will reset it to zero. Are you absolutely sure?`;
      if (confirmBtn) confirmBtn.onclick = () => { closeModal('streakConfirmModal'); _executeCycleDay(); };
      openModal('streakConfirmModal');
      return;
    }
  }

  _doCycleDay(day, btn, next);
}

let _pendingCycleDayArgs = null;

function _executeCycleDay() {
  if (!_pendingCycleDayArgs) return;
  const { day, btn, next } = _pendingCycleDayArgs;
  _pendingCycleDayArgs = null;
  _doCycleDay(day, btn, next);
}

function _doCycleDay(day, btn, next) {
  if (next) state.successDays[day] = next;
  else delete state.successDays[day];

  btn.className = 'daybtn' + (isFuture(day) ? ' future' : '');
  if (next === 'success') {
    btn.classList.add('success');
    btn.textContent = '✓';
  } else if (next === 'fail') {
    btn.classList.add('fail');
    btn.textContent = '✕';
  } else btn.textContent = '·';

  renderStats();
  renderStatusBanner();
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
  setHabitDaysUI(null);
  document.getElementById("habitStartDate").value = "";
  document.getElementById("habitEndDate").value = "";
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
  setHabitDaysUI(h.days || null);
  document.getElementById("habitStartDate").value = h.startDate || "";
  document.getElementById("habitEndDate").value = h.endDate || "";
  document.getElementById("habitModalError").classList.add("hidden");
  openModal("habitModal");
  setTimeout(() => document.getElementById("habitNameInput").focus(), 60);
}

async function saveHabit() {
  const name = document.getElementById("habitNameInput").value.trim();
  const days = getSelectedHabitDays();
  const startDate = document.getElementById("habitStartDate").value || null;
  const endDate = document.getElementById("habitEndDate").value || null;
  const errEl = document.getElementById("habitModalError");

  if (!name) {
    showError(errEl, "Habit name is required.");
    return;
  }

  if (editingHabitId) {
    const h = state.habits.find((x) => x.id === editingHabitId);
    if (h) {
      h.name = name;
      h.days = days;
      h.startDate = startDate;
      h.endDate = endDate;
    }
  } else {
    state.habits.push({
      id: uid(),
      name,
      days,
      startDate,
      endDate,
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
    .map((h) => {
      const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const schedParts = [];
      if (h.days && h.days.length > 0 && h.days.length < 7) {
        const ordered = [1, 2, 3, 4, 5, 6, 0].filter((d) => h.days.includes(d));
        schedParts.push(ordered.map((d) => DOW[d]).join(", "));
      }
      if (h.startDate) schedParts.push("from " + h.startDate);
      if (h.endDate) schedParts.push("until " + h.endDate);
      const schedBadge = schedParts.length
        ? `<span class="habit-sched">${schedParts.join(" · ")}</span>`
        : "";
      return `
    <div class="habit-item" data-habit-id="${h.id}">
      <div class="habit-item-left">
        <span class="habit-drag" title="Hold &amp; drag to reorder">⠿</span>
        <span class="habit-name">${h.name}</span>${schedBadge}
      </div>
      <div class="habit-actions">
        <button class="habit-btn" onclick="openEditHabit('${h.id}')" title="Edit">✎</button>
        <button class="habit-btn del" onclick="deleteHabit('${h.id}')" title="Delete">✕</button>
      </div>
    </div>`;
    })
    .join("");
  _initHabitDrag();
}

// ── STATS ─────────────────────────────────────────────────────────────────────

function renderStats() {
  const habits = state.habits;
  const n = habits.length;

  // Viewed day (shows counts for the currently selected day)
  const todayApplicableStats = habits.filter((h) =>
    isHabitActiveOnDate(h, viewYear, viewMonth, viewDay)
  );
  const todayMap = state.checks[viewDay] || {};
  const todayDone = todayApplicableStats.filter((h) =>
    isDoneValue(todayMap[h.id])
  ).length;
  const nApplicable = todayApplicableStats.length;
  document.getElementById("hToday").textContent = `${todayDone}/${nApplicable}`;

  // Success days
  const succDays = Object.values(state.successDays).filter(
    (v) => v === "success"
  ).length;
  document.getElementById("hSucc").textContent = succDays;

  // Streak — based on previous day; if today unmarked, count from yesterday
  let streak = 0;
  const _isViewToday =
    viewYear === CURRENT_YEAR &&
    viewMonth === CURRENT_MONTH &&
    viewDay === CURRENT_DAY;
  const _todayV = state.successDays[viewDay];
  if (_isViewToday && _todayV === "fail") {
    streak = 0;
  } else {
    const _sStart =
      _isViewToday && _todayV !== "success" ? viewDay - 1 : viewDay;
    for (let d = _sStart; d >= 1; d--) {
      if (state.successDays[d] === "success") streak++;
      else break;
    }
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

  // Success rate = success days / days passed so far
  let succRateCount = 0;
  for (let d = 1; d <= visibleDays; d++) {
    if (state.successDays[d] === "success") succRateCount++;
  }
  const succRatePct = visibleDays
    ? Math.round((succRateCount / visibleDays) * 100)
    : 0;
  document.getElementById("pOverall").textContent = succRatePct + "%";
  document.getElementById("pOverallBar").style.width = succRatePct + "%";

  // Today
  const todayApplicable = habits.filter((h) =>
    isHabitActiveOnDate(h, viewYear, viewMonth, viewDay)
  );
  const todayMap = state.checks[viewDay] || {};
  const todayDone = todayApplicable.filter((h) =>
    isDoneValue(todayMap[h.id])
  ).length;
  const nToday = todayApplicable.length;
  const todayPct = nToday ? Math.round((todayDone / nToday) * 100) : 0;
  document.getElementById("pToday").textContent = todayPct + "%";
  document.getElementById("pTodayBar").style.width = todayPct + "%";
  const pTodaySub = document.getElementById("pTodaySub");
  if (pTodaySub)
    pTodaySub.textContent = `${todayDone} of ${nToday} habits done`;

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

  // Streak — based on previous day; if today unmarked count from yesterday; fail resets to 0
  let streak = 0,
    bestStreak = 0,
    cur = 0;
  const isViewingToday =
    viewYear === CURRENT_YEAR &&
    viewMonth === CURRENT_MONTH &&
    viewDay === CURRENT_DAY;
  const todayVerdict = state.successDays[viewDay];
  if (isViewingToday && todayVerdict === "fail") {
    streak = 0;
  } else {
    const streakStart =
      isViewingToday && todayVerdict !== "success" ? viewDay - 1 : viewDay;
    for (let d = streakStart; d >= 1; d--) {
      if (state.successDays[d] === "success") streak++;
      else break;
    }
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

  // Per-habit streaks — consecutive applicable days each habit was done
  const isViewDay =
    viewYear === CURRENT_YEAR &&
    viewMonth === CURRENT_MONTH &&
    viewDay === CURRENT_DAY;
  const habitStreaks = habits.map((h) => {
    const activeToday = isHabitActiveOnDate(h, viewYear, viewMonth, viewDay);
    const todayDone = activeToday && isDoneValue(state.checks[viewDay]?.[h.id]);
    const startDay =
      isViewDay && activeToday && !todayDone ? viewDay - 1 : viewDay;
    let hstreak = 0;
    for (let d = startDay; d >= 1; d--) {
      if (!isHabitActiveOnDate(h, viewYear, viewMonth, d)) continue; // skip non-scheduled days
      if (isDoneValue(state.checks[d]?.[h.id])) hstreak++;
      else break;
    }
    return { h, hstreak };
  });
  habitStreaks.sort((a, b) => b.hstreak - a.hstreak);

  const headEl = document.getElementById("habitBarsHead");
  if (headEl) {
    headEl.innerHTML = `<span class="sh-icon">\u26A1</span> Habit Streaks <span class="section-hint">consecutive days done</span>`;
  }

  const maxStreak = Math.max(...habitStreaks.map((s) => s.hstreak), 1);
  let barsHtml = "";
  habitStreaks.forEach(({ h, hstreak }) => {
    const color =
      hstreak === 0
        ? "var(--red)"
        : hstreak < 3
        ? "var(--amber)"
        : "var(--green)";
    const barWidth = Math.round((hstreak / maxStreak) * 100);
    barsHtml += `<div class="hbar-row">
      <div class="hbar-name" title="${h.name}">${h.name}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${barWidth}%;background:${color}"></div></div>
      <div class="hbar-meta">
        <span class="hbar-pct" style="color:${color}">${hstreak}</span>
        <span class="hbar-count">day${hstreak !== 1 ? "s" : ""}</span>
      </div>
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
  const isToday = viewYear === CURRENT_YEAR && viewMonth === CURRENT_MONTH && day === CURRENT_DAY;

  // Streak protection when setting fail via day modal
  if (verdict === 'fail' && cur !== 'fail' && isToday) {
    const streak = _computeCurrentStreak();
    if (streak > 0) {
      const confirmBtn = document.getElementById('streakConfirmBtn');
      const numEl = document.getElementById('streakConfirmNum');
      const unitEl = document.getElementById('streakConfirmUnit');
      const msgEl = document.getElementById('streakConfirmMsg');
      if (numEl) numEl.textContent = streak;
      if (unitEl) unitEl.textContent = `day${streak !== 1 ? 's' : ''} at stake`;
      if (msgEl) msgEl.textContent = `You have a ${streak}-day streak. Marking today as failed will reset it to zero. Are you absolutely sure?`;
      if (confirmBtn) confirmBtn.onclick = () => {
        closeModal('streakConfirmModal');
        _applyVerdict(day, verdict);
      };
      // Close day modal first so confirm sits on top
      closeModal('dayModal');
      openModal('streakConfirmModal');
      return;
    }
  }
  _applyVerdict(day, verdict);
}

function _applyVerdict(day, verdict) {
  const cur = state.successDays[day];
  if (cur === verdict) delete state.successDays[day];
  else state.successDays[day] = verdict;
  scheduleSave();
  renderStats();
  renderStatusBanner();
  renderProgressView();
  openDayModal(day);
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
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
  const tabBtn = document.getElementById('tab-' + name);
  if (tabBtn) tabBtn.classList.add('active');
  if (name === 'progress') { renderProgressView(); renderSlipHistory(); }
  if (name === 'calories') renderCalorieView();
  if (name === 'body') renderBodyView();
  if (name === 'notes') renderNotesView();
  // Auto-close sidebar on mobile after selecting a view
  if (window.innerWidth <= 640) {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('mobileBackdrop');
    sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.add('hidden');
    document.body.style.overflow = '';
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

// ── THEME ───────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeButton(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  updateThemeButton(next);
}

function updateThemeButton(theme) {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  btn.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
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

// ── ANTI-SLIP FUNCTIONS ───────────────────────────────────────────────────────

/**
 * Compute the current streak (consecutive success days ending at today or yesterday)
 */
function _computeCurrentStreak() {
  const isViewToday = viewYear === CURRENT_YEAR && viewMonth === CURRENT_MONTH && viewDay === CURRENT_DAY;
  const todayVerdict = state.successDays[CURRENT_DAY];
  if (!isViewToday) return 0; // only compute for current month
  if (todayVerdict === 'fail') return 0;
  const streakStart = todayVerdict !== 'success' ? CURRENT_DAY - 1 : CURRENT_DAY;
  let streak = 0;
  for (let d = streakStart; d >= 1; d--) {
    if (state.successDays[d] === 'success') streak++;
    else break;
  }
  return streak;
}

/**
 * Analyse the last 7 days to detect slip patterns.
 * Returns { recentDays, failCount, successCount, unmarkedCount, recentFailStreak, recentSuccStreak }
 */
function computeSlipState() {
  const isCurrentMonth = viewYear === CURRENT_YEAR && viewMonth === CURRENT_MONTH;
  const today = isCurrentMonth ? CURRENT_DAY : DAYS_IN_VIEW();
  const recentDays = [];
  for (let i = 6; i >= 0; i--) {
    const d = today - i;
    if (d < 1) continue;
    const verdict = state.successDays[d];
    const isToday = isCurrentMonth && d === CURRENT_DAY;
    recentDays.push({ day: d, verdict, isToday });
  }

  let failCount = 0, successCount = 0, unmarkedCount = 0;
  let recentFailStreak = 0, recentSuccStreak = 0;
  let curFail = 0, curSucc = 0;

  recentDays.forEach(({ day, verdict }) => {
    if (verdict === 'fail') { failCount++; curFail++; curSucc = 0; }
    else if (verdict === 'success') { successCount++; curSucc++; curFail = 0; }
    else { unmarkedCount++; curFail = 0; curSucc = 0; }
    recentFailStreak = Math.max(recentFailStreak, curFail);
    recentSuccStreak = Math.max(recentSuccStreak, curSucc);
  });

  return { recentDays, failCount, successCount, unmarkedCount, recentFailStreak, recentSuccStreak, today };
}

/**
 * Render the top status banner in Grid view.
 * States: fire (≥ 3-day streak), slipping (fail yesterday or today), broken (just failed), neutral
 */
function renderStatusBanner() {
  const banner = document.getElementById('statusBanner');
  const iconEl = document.getElementById('statusBannerIcon');
  const titleEl = document.getElementById('statusBannerTitle');
  const subEl = document.getElementById('statusBannerSub');
  if (!banner || !iconEl || !titleEl || !subEl) return;

  const isCurrentMonth = viewYear === CURRENT_YEAR && viewMonth === CURRENT_MONTH;
  if (!isCurrentMonth) {
    // Looking at a past/future month — neutral
    banner.className = 'status-banner state-neutral';
    iconEl.textContent = '\uD83D\uDCCB';
    titleEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
    subEl.textContent = 'Viewing a different month';
    return;
  }

  const streak = _computeCurrentStreak();
  const todayVerdict = state.successDays[CURRENT_DAY];
  const yesterdayVerdict = state.successDays[CURRENT_DAY - 1];

  // Count today's done habits
  const todayApplicable = state.habits.filter(h => isHabitActiveOnDate(h, viewYear, viewMonth, CURRENT_DAY));
  const todayMap = state.checks[CURRENT_DAY] || {};
  const doneTodayCount = todayApplicable.filter(h => isDoneValue(todayMap[h.id])).length;
  const totalTodayCount = todayApplicable.length;
  const pendingCount = totalTodayCount - doneTodayCount;

  let state_name, icon, title, sub;

  if (todayVerdict === 'fail') {
    // Today marked as failed
    state_name = 'state-broken';
    icon = '\uD83D\uDEA8';
    title = 'Today Marked as Failed';
    sub = 'You broke the chain today. Tomorrow is a new day — start fresh.';
  } else if (yesterdayVerdict === 'fail' && todayVerdict !== 'success') {
    // Yesterday failed, today not yet recovered
    const { failCount } = computeSlipState();
    state_name = 'state-broken';
    icon = '\u26A0\uFE0F';
    title = failCount >= 3 ? `${failCount} Fails in the Last Week` : 'Streak Broken Yesterday';
    sub = failCount >= 3
      ? `You\'ve failed ${failCount} of the last 7 days — this is a pattern. Break it today.`
      : 'Yesterday you fell off. Mark today as successful to recover.';
  } else if (streak >= 3) {
    // On fire
    state_name = 'state-fire';
    icon = '\uD83D\uDD25';
    title = `${streak}-Day Streak \u2014 On Fire!`;
    sub = pendingCount > 0
      ? `${pendingCount} habit${pendingCount !== 1 ? 's' : ''} left today. Keep going!`
      : 'All habits done \u2014 mark today as successful!';
  } else if (pendingCount > 0 && totalTodayCount > 0) {
    // Some habits remain
    const { failCount } = computeSlipState();
    if (failCount >= 2) {
      state_name = 'state-slipping';
      icon = '\u26A0\uFE0F';
      title = `Slipping — ${failCount} Fails This Week`;
      sub = `${pendingCount} habit${pendingCount !== 1 ? 's' : ''} still pending. You\'ve failed ${failCount} days recently — don\'t add to that.`;
    } else {
      state_name = 'state-slipping';
      icon = '\uD83D\uDCCB';
      title = `${pendingCount} Habit${pendingCount !== 1 ? 's' : ''} Remaining Today`;
      sub = streak > 0 ? `You have a ${streak}-day streak to protect.` : 'Complete your habits to build momentum.';
    }
  } else if (doneTodayCount === totalTodayCount && totalTodayCount > 0) {
    // All done
    state_name = 'state-fire';
    icon = '\u2705';
    title = 'All Done for Today!';
    sub = streak > 0 ? `${streak}-day streak and counting. Mark today as successful!` : 'Great work — mark today as successful!';
  } else {
    state_name = 'state-neutral';
    icon = '\uD83D\uDCCB';
    title = 'Track Your Day';
    sub = 'Tap habits below to check them off.';
  }

  banner.className = `status-banner ${state_name}`;
  iconEl.textContent = icon;
  titleEl.textContent = title;
  subEl.textContent = sub;
}

/**
 * Render the 7-day slip history panel in Progress view.
 * Inserts it into #slipHistoryPanel if it exists.
 */
function renderSlipHistory() {
  let panel = document.getElementById('slipHistoryPanel');
  if (!panel) {
    // Create and insert after .progress-heroes
    panel = document.createElement('div');
    panel.id = 'slipHistoryPanel';
    const heroes = document.querySelector('#view-progress .progress-heroes');
    if (heroes) heroes.after(panel);
    else {
      const pv = document.getElementById('view-progress');
      if (pv) pv.prepend(panel);
    }
  }

  const { recentDays, failCount, successCount, unmarkedCount, recentFailStreak, recentSuccStreak } = computeSlipState();
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const isCurrentMonth = viewYear === CURRENT_YEAR && viewMonth === CURRENT_MONTH;

  // Build chips
  let chipsHtml = '';
  recentDays.forEach(({ day, verdict, isToday }) => {
    const date = new Date(viewYear, viewMonth, day);
    const dowLabel = DOW[date.getDay()];
    let dotCls = verdict === 'success' ? 's-success' : verdict === 'fail' ? 's-fail' : 's-unmarked';
    if (isToday) dotCls += ' s-today';
    const icon = verdict === 'success' ? '\u2713' : verdict === 'fail' ? '\u2715' : String(day);
    chipsHtml += `<div class="slip-chip">
      <div class="slip-chip-dot ${dotCls}" title="${MONTH_NAMES[viewMonth]} ${day}">${icon}</div>
      <div class="slip-chip-label">${dowLabel}</div>
    </div>`;
  });

  // Build warning
  let warnCls, warnText;
  if (failCount === 0 && successCount >= recentDays.length - 1) {
    warnCls = 'warn-good';
    warnText = '\u2714 Great pattern — you\'ve been consistent this week!';
  } else if (recentFailStreak >= 3) {
    warnCls = 'warn-danger';
    warnText = `\u26A8 Danger: You\'ve failed ${recentFailStreak} days in a row. This is becoming a habit — of the wrong kind.`;
  } else if (failCount >= 3) {
    warnCls = 'warn-danger';
    warnText = `\u26A8 You\'ve failed ${failCount} of the last 7 days. That\'s not a bad day, that\'s a pattern.`;
  } else if (failCount === 2) {
    warnCls = 'warn-caution';
    warnText = `\u26A0 Two fails in 7 days. Don\'t let it become three.`;
  } else if (failCount === 1) {
    warnCls = 'warn-caution';
    warnText = `\u26A0 One slip this week. Keep it isolated — don\'t let it spread.`;
  } else if (!isCurrentMonth) {
    warnCls = 'warn-neutral';
    warnText = 'Viewing a past month.';
  } else {
    warnCls = 'warn-neutral';
    warnText = 'Not enough data yet for this week.';
  }

  panel.innerHTML = `<div class="slip-history">
    <div class="slip-history-head">\uD83D\uDCC5 Last 7 Days</div>
    <div class="slip-history-chips">${chipsHtml}</div>
    <div class="slip-warning ${warnCls}">${warnText}</div>
  </div>`;
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
  toggleDowBtn,
  // anti-slip
  renderStatusBanner,
  renderSlipHistory,
  _executeCycleDay,
});

// ── START ─────────────────────────────────────────────────────────────────────

boot();

// Responsive: auto-switch to single-day view on small screens
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
    console.warn('responsive switch failed', e);
  }
}
window.addEventListener('resize', () => { updateResponsiveSingleDay(); });
updateResponsiveSingleDay();
