# Daily Habit Tracker

A personal habit tracker with cross-device sync via Firebase, hosted on GitHub Pages.

---

## Deploy to GitHub Pages

1. Create a new GitHub repo (e.g. `habit-tracker`)
2. Upload all 3 files: `index.html`, `style.css`, `app.js`
3. Go to **Settings → Pages → Source: main branch → Save**
4. Your tracker is live at `https://your-username.github.io/habit-tracker`

---

## Set Up Firebase (one-time, 5 minutes)

### 1. Create a Firebase project
- Go to [console.firebase.google.com](https://console.firebase.google.com/)
- Click **Add project** → give it a name → Create

### 2. Enable Firestore
- In the left sidebar: **Build → Firestore Database**
- Click **Create database**
- Choose **Start in test mode** (you can lock it down later)
- Pick any region → Done

### 3. Get your config
- Click the gear icon → **Project settings**
- Scroll to **Your apps** → click the `</>` Web icon
- Register the app → you'll see a config object like:

```js
{
  "apiKey": "AIzaSy...",
  "authDomain": "your-project.firebaseapp.com",
  "projectId": "your-project",
  "storageBucket": "your-project.appspot.com",
  "messagingSenderId": "123456789",
  "appId": "1:123:web:abc"
}
```

### 4. Connect
- Open your tracker URL
- Paste the config JSON → click **Connect & Start**
- Done — data now syncs across all your devices instantly

---

## Features

- **Habit grid** — check off habits for each day of the month
- **Add / Edit / Delete / Reorder habits** — drag to reorder
- **Successful Day** — mark each day as ✓ success or ✕ fail (your call)
- **Notes** — add a note for any day
- **Progress view** — overall %, today %, streaks, heatmap, per-habit rates
- **Auto month reset** — new month = fresh grid, old months preserved in Firebase
- **Real-time sync** — changes appear on all devices instantly

---

## Securing Firestore (optional)

Once set up, go to **Firestore → Rules** and replace with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tracker/{doc} {
      allow read, write: if true; // personal use only, no auth needed
    }
  }
}
```

For stricter security with Google login, you can add Firebase Auth later.
