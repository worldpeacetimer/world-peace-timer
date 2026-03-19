import { WINDOW_HOURS } from "./config.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ymdhmsUTC(d) {
  const pad2 = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds())
  );
}

function normPair(a, b) {
  if (!a || !b) return null;
  if (a === b) return null;
  return [a, b].sort().join("–");
}

function kvEnv() {
  // Vercel Storage integrations can inject different env var names depending on provider/prefix.
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.STORAGE_REST_URL ||
    process.env.STORAGE_REST_API_URL;

  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.STORAGE_REST_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;

  return { url, token };
}

async function kvGet(key) {
  const { url, token } = kvEnv();
  if (!url || !token) throw new Error("Missing KV env: (KV_REST_API_URL/KV_REST_API_TOKEN) or (UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN)");

  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`KV get failed: ${resp.status}`);
  const data = await resp.json();
  return data?.result ?? null;
}

async function kvSet(key, value) {
  const { url, token } = kvEnv();
  if (!url || !token) throw new Error("Missing KV env: (KV_REST_API_URL/KV_REST_API_TOKEN) or (UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN)");

  const resp = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`KV set failed: ${resp.status}`);
  return true;
}

async function fetchGdeltDocs({ start, end, max = 250 }) {
  // Use the DOC API (stable) and do country-pair extraction locally.
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");

  // Keep query simple to reduce syntax issues.
  // NOTE: this is a heuristic proxy for "cross-border war".
  url.searchParams.set(
    "query",
    "(war OR attack OR strike OR missile OR drone OR airstrike OR shelling OR invasion)"
  );
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("startdatetime", start);
  url.searchParams.set("enddatetime", end);
  url.searchParams.set("maxrecords", String(max));
  url.searchParams.set("sort", "HybridRel");

  const resp = await fetch(url.toString(), {
    headers: { "user-agent": "world-peace-timer/1.0" }
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`GDELT HTTP ${resp.status}: ${text.slice(0, 240)}`);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GDELT non-JSON response: ${text.slice(0, 240)}`);
  }
}

export default async function handler(req, res) {
  try {
    // Optional shared secret to prevent random people from calling refresh.
    const expected = process.env.REFRESH_TOKEN;
    const provided = req.query?.token;
    if (expected && provided !== expected) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const now = new Date();
    const end = ymdhmsUTC(now);
    const start = ymdhmsUTC(new Date(now.getTime() - WINDOW_HOURS * 3600 * 1000));

    const out = {
      ok: true,
      updatedAtISO: now.toISOString(),
      windowHours: WINDOW_HOURS,
      activeConflicts: [],
      diagnostics: []
    };

    // ====== Refresh lock (prevents hammering upstream / 429) ======
    const lockKey = "refresh_lock_until";
    const lockMs = 10 * 60 * 1000; // 10 minutes

    try {
      const untilRaw = await kvGet(lockKey);
      const until = untilRaw ? Number(untilRaw) : 0;
      if (until && now.getTime() < until) {
        // Locked: return current cached status instead of calling upstream
        const cached = await kvGet("status");
        const cachedObj = cached ? JSON.parse(cached) : null;
        res.setHeader("cache-control", "no-store");
        res.status(200).json({
          ok: true,
          skipped: true,
          reason: "locked",
          nextAllowedAtISO: new Date(until).toISOString(),
          cachedStatus: cachedObj
        });
        return;
      }

      // Set lock optimistically
      await kvSet(lockKey, String(now.getTime() + lockMs));
    } catch (e) {
      // If lock fails, still proceed (best effort)
      out.diagnostics.push({ scope: "lock", error: String(e?.message || e) });
    }

  // Read previous state
  let prevIsWarNow = null;
  let peaceStartAtISO = null;

  try {
    const prev = await kvGet("status");
    if (prev) {
      const prevObj = JSON.parse(prev);
      prevIsWarNow = !!prevObj.isWarNow;
      peaceStartAtISO = prevObj.peaceStartAtISO || null;
    }
  } catch (e) {
    out.diagnostics.push({ scope: "kv", error: String(e?.message || e) });
  }

  // Fetch upstream with gentle handling
  let json;
  try {
    json = await fetchGdeltDocs({ start, end, max: 100 });
  } catch (e) {
    // Retry once after a pause (helps 429 sometimes)
    await sleep(6500);
    try {
      json = await fetchGdeltDocs({ start, end, max: 100 });
    } catch (e2) {
      out.ok = false;
      out.diagnostics.push({ scope: "upstream", error: String(e2?.message || e2), retried: true });
      // If we can't refresh, do not overwrite KV.
      res.status(200).json(out);
      return;
    }
  }

  const articles = json?.articles || [];
  out.diagnostics.push({ scope: "sample", sampleSeendates: articles.slice(0, 5).map(a => a?.seendate ?? null) });
  const map = new Map();

  const { extractCountries } = await import("./countries.js");

  const CONFLICT_PATTERNS = [
    /\bwar\b/i,
    /\bvs\b/i,
    /\bv\.?s\.?\b/i,
    /\bclash(es)?\b/i,
    /\battack(s|ed|ing)?\b/i,
    /\bstrike(s|d)?\b/i,
    /\bbomb(ing|ed|s)?\b/i,
    /\bmissile(s)?\b/i,
    /\bdrone(s)?\b/i,
    /\binvasion\b/i,
    /\bshell(ing|ed)?\b/i,
    /\braid(s)?\b/i,
    /\bfire\b/i,
    /\bhit(s|ting)?\b/i,
    /\bkills?\b/i
  ];

  function looksLikeConflictPair(text, a, b) {
    const t = String(text || "");
    const hasConflict = CONFLICT_PATTERNS.some((re) => re.test(t));
    if (!hasConflict) return false;

    const aRe = escapeRe(a);
    const bRe = escapeRe(b);

    // Negative heuristic: allied/coordinated phrasing like "US-Israel" or "A and B" often appears
    // in headlines like "US-Israel war on Iran". That should NOT be counted as A vs B.
    const alliedRe = new RegExp(
      `(?:${aRe}\\s*[-–]\\s*${bRe}|${bRe}\\s*[-–]\\s*${aRe}|${aRe}\\s+and\\s+${bRe}|${bRe}\\s+and\\s+${aRe})`,
      "i"
    );
    const directedAgainstRe = /\b(war on|strike(s)? on|attack(s)? on|campaign in)\b/i;
    if (alliedRe.test(t) && directedAgainstRe.test(t)) return false;

    // Positive heuristic: detect A ... (vs/war/attack/strike) ... B within a short window.
    const mid = "(?:.{0,80})";
    const link = "(?:vs\\.?|v\\.?s\\.?|war|attack(?:ed|s|ing)?|strike(?:s|d)?|clash(?:es)?|hit|kills?)";
    const re1 = new RegExp(`${aRe}${mid}${link}${mid}${bRe}`, "i");
    const re2 = new RegExp(`${bRe}${mid}${link}${mid}${aRe}`, "i");
    return re1.test(t) || re2.test(t);
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function parseSeenISO(art) {
    const sd = art?.seendate;
    if (!sd) return null;

    const s = String(sd);

    if (/^\d{14}$/.test(s)) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}.000Z`;
    }

    if (/^\d{8}T\d{6}Z$/.test(s)) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.000Z`;
    }

    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString();
  }

  for (const art of articles) {
    // Use title+description for detection context.
    const text = `${art?.title || ""} ${art?.description || ""}`;
    const countries = extractCountries(text);
    if (!countries || countries.length < 2) continue;

    // build all unique pairs in this article, but only keep pairs that look like actual confrontation
    for (let i = 0; i < countries.length; i++) {
      for (let j = i + 1; j < countries.length; j++) {
        const a = countries[i];
        const b = countries[j];

        if (!looksLikeConflictPair(text, a, b)) continue;

        const pair = normPair(a, b);
        if (!pair) continue;

        const cur = map.get(pair) || {
          pair,
          lastSeenISO: null,
          count: 0,
          links: []
        };

        cur.count += 1;

        const seen = parseSeenISO(art);
        if (seen && (!cur.lastSeenISO || seen > cur.lastSeenISO)) cur.lastSeenISO = seen;

        if (art?.url && cur.links.length < 3) {
          cur.links.push({ label: art?.title || art.url, url: art.url });
        }

        map.set(pair, cur);
      }
    }
  }

  // Threshold: at least 2 matching articles in last 24h counts as "active" (tunable)
  const active = [...map.values()]
    .filter((x) => x.count >= 2)
    .sort((x, y) => (y.count - x.count) || x.pair.localeCompare(y.pair))
    .slice(0, 50)
    .map((x) => ({
      pair: x.pair,
      lastSeenISO: x.lastSeenISO,
      articles: x.count,
      sources: 0,
      links: x.links
    }));

  // If we failed to parse dates (or had too little data), don't treat that as war.
  const isWarNow = active.length > 0;

  // Peace timer logic: if transition war->peace, reset peaceStartAtISO to now.
  if (!isWarNow) {
    if (prevIsWarNow === true || !peaceStartAtISO) {
      peaceStartAtISO = now.toISOString();
    }
  } else {
    // If war now, keep the last peaceStartAtISO as-is (or set a default).
    if (!peaceStartAtISO) peaceStartAtISO = now.toISOString();
  }

  const status = {
    isWarNow,
    peaceStartAtISO,
    updatedAtISO: now.toISOString(),
    windowHours: WINDOW_HOURS,
    minArticles: 2,
    activeConflicts: active,
    diagnostics: out.diagnostics
  };

  try {
    await kvSet("status", JSON.stringify(status));
  } catch (e) {
    out.ok = false;
    out.diagnostics.push({ scope: "kv", error: String(e?.message || e) });
  }

    out.activeConflicts = active;
    res.setHeader("cache-control", "no-store");
    res.status(200).json({ ...out, isWarNow, peaceStartAtISO });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
