# Auction ProForma — Setup

## What's here

- `Auction Sheet - Google Sheets Ready.xlsx` — your Auction Spreadsheet, cleaned up:
  the messy `HUD` column has been split into a numeric `HUD_Amount` (auto-parsed) and
  `HUD_Notes_Raw` (original text, for anything the parser guessed wrong). Column
  headers are also renamed to be unambiguous (`Judgment`, `Mortgage_Balance`, etc.).
- The Next.js app (this folder — `app/`, `lib/`, `package.json`, etc. all live at
  the repo root), with three pages sharing the same layout:
  - **Sheriff Sales** (`/`) — HOA-judgment foreclosure deals. Goal: sell within 240
    days; Max Bid is calculated to leave at least $50,000 profit.
  - **NTS / Trustee Sale** (`/nts`) — mortgage/deed-of-trust foreclosure deals. Goal:
    sell within 90 days; Max Bid is calculated to leave at least $50,000 profit.
  - **Purchased** (`/purchased`) — on a property's Base Figures panel (Sheriff
    Sales or NTS tab), enter the **Sale Price** it actually sold for (required)
    and, if someone other than you bought it, their name in **Purchased By**
    (leave blank if it was you), then click **Mark Purchased**. The property
    moves here indefinitely (no 3-month auction-date restriction) and the row
    is highlighted green on the Sheet. On the Purchased tab, a **Move Back /
    Undo Purchase** button clears both fields and the highlight, moving it back.
  - A tab toggle at the top of the page switches between them.
  - **Row color conventions (when connected to a live Sheet)**: if you manually
    highlight a row **red** in the Sheet, it's dropped from every tab entirely —
    use that for dead deals. If you highlight a row **green** (without going
    through Mark Purchased), it's treated as already purchased and filed under
    the Purchased tab automatically. This works with any shade of red/green
    from the Sheets fill-color palette, not just one exact color.
  - Run it locally now; it works immediately using bundled sample data (both tabs
    currently show the same sample rows until you add a real "NTS" tab — see below).
    Once you finish the Google Cloud steps, it automatically switches to reading
    your live Google Sheet instead (no code changes needed).

## Run it now (sample data)

```
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
as new properties come up, and the app will pick them up automatically. Marking
a property purchased writes the buyer's name and sale price into columns **AD**
(Purchaser) and **AE** (Price), matching the row by its `ID` column — these are
fixed columns regardless of header text, chosen because they're the first
genuinely empty columns after your existing data (don't put anything else
there). If your sheet's layout is different and AD/AE aren't actually empty,
tell me and I'll point the app at different columns instead.

### 2. Create a Google Cloud project + enable the Sheets API
1. Go to https://console.cloud.google.com/ and create a new project (or pick an existing one).
2. In the search bar, search "Google Sheets API" → click it → **Enable**.

### 3. Authenticate — pick ONE of these two options

#### Option A: Connect via OAuth (your own Google account — no sharing step needed)
Use this if you don't want to create/manage a service account JSON key. You
authenticate as yourself, so you automatically have access to any sheet you
can already open — no separate "Share with a robot email" step.

1. In Cloud Console: **APIs & Services → Credentials → Create Credentials →
   OAuth client ID**.
2. If prompted, configure the **OAuth consent screen** first: User type
   "External" is fine, publishing status can stay "Testing" — just add your
   own Google account under **Test users**.
3. Application type: **Web application**. Under **Authorized redirect URIs**,
   add `http://localhost:3210/api/oauth/callback` (adjust the port if you run
   `npm run dev` on a different one).
4. Copy the **Client ID** and **Client Secret** shown after creating it.
5. `cp .env.example .env.local`, then fill in `GOOGLE_OAUTH_CLIENT_ID` and
   `GOOGLE_OAUTH_CLIENT_SECRET` with those values.
6. Run `npm run dev`, then visit **http://localhost:3210/api/oauth/start** in
   your browser. Sign in with the Google account that can open/edit the
   sheet, and approve access.
7. You'll land on a plain text page showing a refresh token — copy it into
   `GOOGLE_OAUTH_REFRESH_TOKEN` in `.env.local`.
8. Later, paste all three (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `GOOGLE_OAUTH_REFRESH_TOKEN`) into Vercel's Environment Variables too — the
   redirect URI above only needs to work locally, since you're just using it
   once to mint a refresh token you then reuse everywhere.

Caveat: while the OAuth consent screen is in "Testing" status, Google may
expire this refresh token after a period of inactivity. If the connection
silently reverts to "Sample data" after a while, just redo steps 6-7 to get a
fresh token.

#### Option B: Service account JSON key
1. In Cloud Console: **IAM & Admin → Service Accounts → Create Service Account**.
2. Give it any name (e.g. `auction-sheet-reader`). No roles needed — click through to Done.
3. Click the new service account → **Keys** tab → **Add Key → Create new key → JSON**.
   This downloads a JSON file — keep it private, don't commit it anywhere.
4. Open the downloaded JSON, find the `client_email` field (looks like
   `auction-sheet-reader@your-project.iam.gserviceaccount.com`). In your Google
   Sheet, click **Share** and add that email as an **Editor** (not just Viewer —
   marking something Purchased needs to write back to the sheet).
5. `cp .env.example .env.local`, then fill in:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the `client_email` from the JSON key.
   - `GOOGLE_PRIVATE_KEY` — the `private_key` field from the JSON key, quoted,
     keeping the `\n` sequences exactly as they appear (don't turn them into
     real line breaks).

### 4. Fill in the rest of your local environment file
Whichever option you picked above, also set:
- `GOOGLE_SHEET_ID` — from your sheet's URL:
  `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
- `GOOGLE_SHEET_RANGE_SHERIFF` — the Sheriff Sales tab name + range, e.g. `Auction!A1:Z1000`
  (use whatever your tab is actually named — it does NOT have to be "Auction").
- `GOOGLE_SHEET_RANGE_NTS` — the NTS tab name + range, e.g. `NTS!A1:Z1000`.

Restart `npm run dev`. The badge should switch to "Live: Google Sheets".

Note: until the sheet is connected with Editor access, marking something
Purchased falls back to writing a local file (`data/purchased.json`) instead.
That file only works on the machine that wrote it — it will NOT persist once
this app is deployed (see below), so finish this step before you rely on the
Purchased tab in production. The app shows an alert if a click fails or only
saves locally, so you'll know immediately if this step is still missing.

## Source code

The code is on GitHub (private): https://github.com/Axe3ventures/hoa-auction-proforma-tool

## Deploying to Vercel (publish it online)

1. Go to https://vercel.com and sign in with GitHub.
2. **Add New... → Project** → import `Axe3ventures/hoa-auction-proforma-tool`.
   Root Directory can stay at its default (the app lives at the repo root).
3. Under **Environment Variables**, add the same ones from `.env.local` — whichever
   auth option you set up:
   - OAuth: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`
   - Service account: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (paste with the `\n` sequences intact)
   - Either way: `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_RANGE_SHERIFF`, `GOOGLE_SHEET_RANGE_NTS`
4. Click **Deploy**. Vercel builds and gives you a live `*.vercel.app` URL.
5. From then on, every `git push` to `master` auto-redeploys — but adding or
   changing an environment variable does NOT trigger a redeploy by itself,
   you need to hit **Redeploy** on the latest deployment for it to take effect.

Important: on Vercel the filesystem is read-only in production, so the local
`data/purchased.json` fallback won't work there — make sure the Google Sheet
connection (OAuth or service account with Editor access) is set up before
relying on the Purchased tab once deployed, or Mark Purchased clicks will
silently not stick.

## Self-diagnosing the connection

Visit `<your-deployed-url>/api/debug?type=sheriff` (or `?type=nts`) any time.
It reports: which auth mode is active, whether the target tab was found, the
header row and whether the `ID` column was detected, sample row background
colors (raw values + how they're classified), sample purchaser/price data
from columns AD/AE, and a real Editor/write-access test. No secrets are
included in the response.

## Moving this to another machine

This is a standard Next.js app — no special local dependencies. Clone the repo
above and run `npm install && npm run dev` anywhere.
