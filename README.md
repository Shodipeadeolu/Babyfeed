# 🍼 BabyFeed PWA

A baby feeding tracker that installs like a real app on iPhone — **completely free to share**.

## Files
- `index.html` — the entire app (self-contained)
- `manifest.json` — makes it installable on iPhone/Android
- `sw.js` — service worker for offline support
- `README.md` — this file

---

## 🚀 How to Host for Free (share a link in minutes)

### Option A — Netlify Drop (easiest, 2 minutes)
1. Go to **https://app.netlify.com/drop**
2. Drag the entire `babyfeed-pwa` folder onto the page
3. Netlify gives you a free link like `https://amazing-name-123.netlify.app`
4. Share that link with anyone!

### Option B — GitHub Pages (free forever)
1. Create a free account at **https://github.com**
2. Create a new repository called `babyfeed`
3. Upload all 3 files (`index.html`, `manifest.json`, `sw.js`)
4. Go to Settings → Pages → Source: `main` branch
5. Your link will be `https://yourusername.github.io/babyfeed`

### Option C — Vercel (also free)
1. Go to **https://vercel.com**
2. Sign up free, click "Add New Project"
3. Drag and drop the folder
4. Get a link instantly

---

## 📱 How Users Install on iPhone
1. Open the link in **Safari** (must be Safari, not Chrome)
2. Tap the **Share button** (box with arrow at bottom)
3. Tap **"Add to Home Screen"**
4. Tap **"Add"**
5. The app appears on their home screen like a real app! 🎉

## 📱 How Users Install on Android
1. Open the link in **Chrome**
2. Tap the **3-dot menu** → "Add to Home Screen" or "Install App"
3. Done!

---

## ✨ Features
- Track feeds for multiple babies
- Breast / Formula / Mixed milk types
- Feeding timer with emergency alarm 🚨
- Dashboard with charts & heatmaps 📊
- Feed history
- **Data saved locally** on device (localStorage)
- Works offline after first load

---

## 💰 Cost
- Hosting: **FREE** (Netlify/GitHub/Vercel all have free tiers)
- App Store: **Not needed** — this is a PWA
- Apple Developer fee: **$0** — PWAs don't need App Store approval
