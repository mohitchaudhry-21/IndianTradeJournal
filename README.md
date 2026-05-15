# OptionsDesk — Indian Market Options Journal

A professional trading journal for Indian stock market options sellers.
Built for NIFTY / BANKNIFTY / FINNIFTY options with multi-leg position tracking.

---

## 🚀 Deploy to GitHub Pages

### Step 1 — Create GitHub account
Go to **github.com** → Sign up (free)

### Step 2 — Create a new repository
1. Click **+** → **New repository**
2. Name: `optionsdesk` · Visibility: ✅ **Public** · Click **Create repository**

### Step 3 — Upload the code
1. Extract this ZIP → open the `options-journal` folder
2. On your empty GitHub repo → click **uploading an existing file**
3. Select everything inside `options-journal` (Ctrl+A) → drag into GitHub
   > ⚠️ Drag the **contents**, not the folder itself. You should see `package.json`, `src/`, `public/`, `.github/` in GitHub.
4. Click **Commit changes**

### Step 4 — Enable GitHub Pages
Repo **Settings → Pages → Source: GitHub Actions** → done.

### Step 5 — Wait for build
**Actions** tab → watch **Deploy OptionsDesk** workflow → green ✓ in ~3 minutes.

### Step 6 — Open your app
```
https://YOUR-GITHUB-USERNAME.github.io/optionsdesk
```

---

## ☁️ Supabase Setup (Cross-Device Sync)

### Step 1 — Create Supabase project
1. Go to **supabase.com** → sign up free → **New project**
2. Pick a name, password, region → **Create project** → wait ~2 min

### Step 2 — Create the table
SQL Editor → New query → paste and run:

```sql
create table if not exists od_data (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz default now()
);
alter table od_data enable row level security;
create policy "Allow all" on od_data for all using (true);
```

### Step 3 — Get credentials
**Project Settings → API** → copy **Project URL** and **anon/public key**

### Step 4 — Connect in app
**Settings → Cloud Sync** → paste URL and key → **Connect**

✓ Now syncs automatically across all devices.

---

## 💻 Run Locally
```
npm install
npm start
```
