/**
 * SupplyMate AI Platform — Universal Data Connector
 * Doc 03 §10, Doc 07 §11: applications never talk to Google Sheets directly.
 * They talk to THIS worker. Swapping Sheets for Postgres/ERP later means
 * changing this file only — no app is ever touched.
 *
 * Routes:
 *   GET /health
 *   GET /connector/:sheetKey/:tab
 *
 * Example:
 *   GET /connector/ceo-os/KPI_Summary
 *   -> { sheetKey, tab, count, rows: [ {Date, Revenue_MTD, ...}, ... ], cachedAt }
 */

// ---------------------------------------------------------------------------
// Sheet Registry — one entry per Operating System's master sheet.
// Add a new OS by adding one line here. Nothing else in this file changes.
// ---------------------------------------------------------------------------
const SHEET_REGISTRY = {
  "ceo-os": {
    id: "13TElr9696UTv6EyU2OGa44IAYWC0SkYH",
    label: "CEO OS Master Sheet",
  },
  // "sales-os": { id: "REPLACE_ME", label: "Sales OS Master Sheet" },
  // "finance-os": { id: "REPLACE_ME", label: "Finance OS Master Sheet" },
};

// Tabs this connector is allowed to serve for ceo-os. Extend per sheetKey
// if different sheets have different tab sets.
const ALLOWED_TABS = [
  "KPI_Summary",
  "Daily_Activity_Feed",
  "Priorities_Today",
  "Department_Performance",
  "Approvals_Queue",
  "Risks_Opportunities",
  "Weekly_Report",
  "Departments_Config",
];

const CACHE_SECONDS = 60;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// Converts Sheets API "values" grid (array of arrays) into an array of
// objects keyed by the header row. Skips fully-empty rows.
function rowsToObjects(values) {
  if (!values || values.length === 0) return [];
  const [header, ...rows] = values;
  return rows
    .filter((r) => r.some((cell) => cell !== undefined && cell !== ""))
    .map((row) => {
      const obj = {};
      header.forEach((key, i) => {
        obj[key] = row[i] !== undefined ? row[i] : null;
      });
      return obj;
    });
}

async function fetchTab(spreadsheetId, tab, apiKey) {
  const range = encodeURIComponent(`${tab}!A1:Z1000`);
  // UNFORMATTED_VALUE returns real numbers (e.g. 0.082 for a cell formatted
  // as 8.2%) instead of display strings — keeps downstream math correct.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${apiKey}&valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Sheets API ${res.status}: ${text}`);
  }
  const data = await res.json();
  return rowsToObjects(data.values || []);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/health") {
      return jsonResponse({
        status: "ok",
        service: "platform-data-connector",
        registeredSheets: Object.keys(SHEET_REGISTRY),
      });
    }

    const match = url.pathname.match(/^\/connector\/([a-z0-9-]+)\/([A-Za-z_]+)$/);
    if (!match) {
      return jsonResponse(
        {
          error:
            "Invalid path. Use /connector/:sheetKey/:tab — e.g. /connector/ceo-os/KPI_Summary",
        },
        400
      );
    }

    const [, sheetKey, tab] = match;
    const sheetConfig = SHEET_REGISTRY[sheetKey];

    if (!sheetConfig || sheetConfig.id.startsWith("REPLACE_")) {
      return jsonResponse(
        { error: `Sheet '${sheetKey}' is not configured yet. Set its ID in src/index.js.` },
        404
      );
    }
    if (!ALLOWED_TABS.includes(tab)) {
      return jsonResponse({ error: `Unknown tab '${tab}'` }, 404);
    }
    if (!env.GOOGLE_SHEETS_API_KEY) {
      return jsonResponse(
        { error: "GOOGLE_SHEETS_API_KEY secret is not set on this Worker." },
        500
      );
    }

    // Cache per exact URL for CACHE_SECONDS — cheap and keeps every app fast
    // without hammering the Sheets API on every dashboard load.
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      const rows = await fetchTab(sheetConfig.id, tab, env.GOOGLE_SHEETS_API_KEY);
      const response = jsonResponse({
        sheetKey,
        sheetLabel: sheetConfig.label,
        tab,
        count: rows.length,
        rows,
        cachedAt: new Date().toISOString(),
      });
      response.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      return jsonResponse({ error: err.message }, 502);
    }
  },
};
