# Auction ProForma — Setup

## What's here

- `Auction Sheet - Google Sheets Ready.xlsx` — your Auction Spreadsheet, cleaned up:
  the messy `HUD` column has been split into a numeric `HUD_Amount` (auto-parsed) and
  `HUD_Notes_Raw` (original text, for anything the parser guessed wrong). Column
  headers are also renamed to be unambiguous (`Judgment`, `Mortgage_Balance`, etc.),
  and a blank `Purchased` column has been added at the end for the checkbox below.
- `webapp/` — the Next.js app, with three pages sharing the same layout:
  - **Sheriff Sales** (`/`) — HOA-judgment foreclosure deals. Goal: sell within 240
    days; Max Bid is calculated to hit a 25% minimum ROI.
  - **NTS / Trustee Sale** (`/nts`) — mortgage/deed-of-trust foreclosure deals. Goal:
    sell within 60 days; Max Bid is calculated to hit a 10% minimum ROI.
  - **Purchased** (`/purchased`) — check the "Purchased" box on the Base Figures
    panel of either page above and the property moves here indefinitely (no
    3-month auction-date restriction). Unchecking it moves it back.
  - A tab toggle at the top of the page switches between them.
  - Run it locally now; it works immediately using bundled sample data (both tabs
    currently show the same sample rows until you add a real "NTS" tab — see below).
    Once you finish the Google Cloud steps, it automatically switches to reading
    your live Google Sheet instead (no code changes needed).

## Run it now (sample data)

```
cd webapp
npm install   # already done
npm run dev
```

Open http://localhost:3000 (or whatever port you choose). You'll see a
"Sample data" badge in the top right — that's the local fallback.

## Connect it to your live Google Sheet

### 1. Upload the cleaned spreadsheet to Google Sheets
Go to Google Drive → New → File upload → pick `Auction Sheet - Google Sheets Ready.xlsx`.
Right-click it → "Open with Google Sheets" (this converts it). Rename the tab at
the bottom to `Auction` (the app looks for a tab named `Auction` by default — this
is your Sheriff Sales data).

To add NTS/Trustee Sale deals, duplicate that tab (right-click the tab → Duplicate),
rename the copy to `NTS`, and replace the rows with your trustee sale properties —
keep the same column headers so the app can read it. The `/nts` page reads from
this tab.

Keep using this Google Sheet as your live tracker going forward — add new rows
as new properties come up, and the app will pick them up automatically. Both tabs
need a blank `Purchased` column (already included in the cleaned file) — the
Purchased checkbox writes `TRUE`/blank into that column by matching the row's `ID`.

### 2. Create a Google Cloud project + enable the Sheets API
1. Go to https://console.cloud.google.com/ and create a new project (or pick an existing one).
2. In the search bar, search "Google Sheets API" → click it → **Enable**.

### 3. Create a service account (this is how the app authenticates)
1. In Cloud Console: **IAM & Admin → Service Accounts → Create Service Account**.
2. Give it any name (e.g. `auction-sheet-reader`). No roles needed — click through to Done.
3. Click the new service account → **Keys** tab → **Add Key → Create new key → JSON**.
   This downloads a JSON file — keep it private, don't commit it anywhere.

### 4. Share your Google Sheet with the service account
Open the downloaded JSON, find the `client_email` field (looks like
`auction-sheet-reader@your-project.iam.gserviceaccount.com`). In your Google
Sheet, click **Share** and add that email as an **Editor** (not just Viewer —
the Purchased checkbox needs to write back to the sheet).

### 5. Fill in your local environment file
```
cd webapp
cp .env.example .env.local
```
Edit `.env.local`:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the `client_email` from the JSON key.
- `GOOGLE_PRIVATE_KEY` — the `private_key` field from the JSON key, quoted, keeping
  the `\n` sequences exactly as they appear (don't turn them into real line breaks).
- `GOOGLE_SHEET_ID` — from your sheet's URL:
  `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
- `GOOGLE_SHEET_RANGE_SHERIFF` — leave as `Auction!A1:Z1000` if you kept the tab named `Auction`.
- `GOOGLE_SHEET_RANGE_NTS` — leave as `NTS!A1:Z1000` once you've added the `NTS` tab.

Restart `npm run dev`. The badge should switch to "Live: Google Sheets".

Note: until the sheet is connected with Editor access and has a `Purchased`
column, the checkbox falls back to writing a local file
(`webapp/data/purchased.json`) instead. That file only works on the machine
that wrote it — it will NOT persist once this app is deployed (see below), so
finish this step before you rely on the Purchased tab in production.

## Moving this to another machine or hosting it online later

This is a standard Next.js app — no special local dependencies. To move it:
- Copy the `webapp/` folder (or put it in git) and run `npm install && npm run dev` anywhere.
- To host it so it's reachable from a URL instead of just localhost, deploy to
  Vercel (`npx vercel` from inside `webapp/`) and paste the same four env vars
  into the Vercel project's Environment Variables settings. No code changes needed.
