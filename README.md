# Platform Data Connector

The Universal Data Connector for the SupplyMate AI Platform (Doc 03 §10).
Every application reads business data through this one Worker instead of
talking to Google Sheets directly. This is the first Platform Kernel /
Shared Service in the architecture to actually get built.

## What it does

`GET /connector/:sheetKey/:tab` → returns the named tab of the named sheet
as JSON, using the tab's header row as object keys.

Example: `GET /connector/ceo-os/KPI_Summary`

```json
{
  "sheetKey": "ceo-os",
  "tab": "KPI_Summary",
  "count": 2,
  "rows": [
    { "Date": "2026-07-01", "Revenue_MTD": 18400000, "Revenue_Change_Pct": 0.082, ... }
  ],
  "cachedAt": "2026-07-02T09:00:00.000Z"
}
```

## One-time setup

1. **Enable the Sheets API**
   Go to [Google Cloud Console](https://console.cloud.google.com/) → create
   or pick a project → APIs & Services → Library → enable "Google Sheets API".

2. **Create an API key**
   APIs & Services → Credentials → Create Credentials → API key.
   Restrict it to the Sheets API only (Application restrictions optional,
   API restrictions → Google Sheets API).

3. **Share the CEO OS Master Sheet**
   Open the sheet → Share → General access → "Anyone with the link" → Viewer.
   (Phase 1 read-only, per Doc 04 §10 progressive migration. This makes the
   sheet link-viewable — fine for internal operational data, but don't put
   anything in it you wouldn't want viewable by anyone with the URL. Phase 2
   can swap this for a private service-account connection without changing
   any app.)

4. **Get the Sheet ID**
   From the URL: `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

5. **Register the sheet**
   In `src/index.js`, replace `REPLACE_WITH_CEO_OS_MASTER_SHEET_ID` in
   `SHEET_REGISTRY["ceo-os"].id` with the ID from step 4.

6. **Set the secret**
   ```
   wrangler secret put GOOGLE_SHEETS_API_KEY
   ```
   Paste the API key from step 2 when prompted.

7. **Deploy**
   Push this repo to GitHub as `Platform-Data-Connector` under the
   `websupplymate-ai` org, same as the other OS repos — Cloudflare picks it
   up automatically. Or run `wrangler deploy` directly.

8. **Test it**
   ```
   curl https://platform-data-connector.web-supplymate.workers.dev/connector/ceo-os/KPI_Summary
   ```

## Adding the next sheet (e.g. Sales OS)

Add one entry to `SHEET_REGISTRY` in `src/index.js` and redeploy. No app
that already calls this connector needs to change.

## Notes

- Responses are cached 60 seconds at the edge — dashboards stay fast, the
  Sheets API doesn't get hammered.
- CORS is open (`*`) since every OS subdomain calls this. Tighten to specific
  origins once all app domains are final.
- If a tab or sheet isn't configured, the connector returns a clear 404/500
  JSON error rather than failing silently — apps should fall back to cached
  or placeholder data in that case (see CEO Dashboard's fallback behavior).
