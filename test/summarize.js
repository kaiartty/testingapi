// test/summarize.js (FOUND lists + ✓ for passed)
const fs = require("fs");
const path = require("path");

const RESULT = path.join(__dirname, "results", "result.json");
const SUMMARY = path.join(__dirname, "results", "summary.json");

// ---------- utils ----------
const toRad = (d) => (d * Math.PI) / 180;
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function headerMap(req) {
  const map = {};
  (req.header || []).forEach((h) => {
    map[String(h.key || "").toLowerCase()] = h.value;
  });
  return map;
}
function getPlaceFrom(ex, idx) {
  const h = headerMap(ex.request || {});
  if (h["x-place-enc"]) {
    try {
      return decodeURIComponent(h["x-place-enc"]);
    } catch {
      return h["x-place-enc"];
    }
  }
  const u = ex.request && ex.request.url;
  if (u && Array.isArray(u.query)) {
    const q = u.query.find((o) => o.key === "place");
    if (q && q.value) {
      try {
        return decodeURIComponent(q.value);
      } catch {
        return q.value;
      }
    }
  }
  return ex.item?.name || `case#${idx + 1}`;
}
function nameInParens(str) {
  const m = String(str || "").match(/\(([^)]+)\)/);
  return m ? m[1] : null;
}
function toKey(s) {
  const k = String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return k || "unknown";
}
function getProviderKey(ex) {
  const byParen = nameInParens(ex.item?.name);
  if (byParen) return toKey(byParen);
  const u = ex.request && ex.request.url;
  const segs = u && Array.isArray(u.path) ? u.path.map(String.toString) : [];
  const i = segs.indexOf("locations");
  if (i >= 0 && segs[i + 1]) return toKey(segs[i + 1]);
  const name = ex.item?.name || "unknown";
  return toKey(name);
}
function numOrNull(x) {
  return Number.isFinite(x) ? x : null;
}
const hasCoords = (rec) =>
  rec && Number.isFinite(rec.apiLat) && Number.isFinite(rec.apiLng);

// ---------- main ----------
if (!fs.existsSync(RESULT)) {
  console.error("❌ ไม่พบไฟล์:", RESULT);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(RESULT, "utf8"));
const executions = data.run?.executions || [];

const perPlace = new Map();
const stats = Object.create(null);

executions.forEach((ex, idx) => {
  const h = headerMap(ex.request || {});
  const place = getPlaceFrom(ex, idx);
  const providerKey = getProviderKey(ex);
  const refLat = parseFloat(h["x-ref-lat"]);
  const refLng = parseFloat(h["x-ref-lng"]);
  const threshold = parseFloat(h["x-threshold"]);
  const statusCode = ex.response?.code ?? null;

  let apiLat = NaN,
    apiLng = NaN;
  try {
    const buf = Buffer.from(ex.response?.stream?.data || []);
    const body = JSON.parse(buf.toString("utf8"));
    apiLat = Number(body?.data?.lat);
    apiLng = Number(body?.data?.lng);
  } catch (_) {}

  let distance = NaN,
    pass = false;
  if ([apiLat, apiLng, refLat, refLng].every(Number.isFinite)) {
    distance = haversine(apiLat, apiLng, refLat, refLng);
    pass = Number.isFinite(threshold) ? distance <= threshold : false;
  }

  if (!perPlace.has(place)) perPlace.set(place, { place });
  const row = perPlace.get(place);
  const rec = {
    refLat: numOrNull(refLat),
    refLng: numOrNull(refLng),
    apiLat: numOrNull(apiLat),
    apiLng: numOrNull(apiLng),
    passThresholdMeters: numOrNull(threshold),
    distanceM: Number.isFinite(distance) ? Number(distance.toFixed(2)) : null,
    pass,
    statusCode,
  };
  row[`r_${providerKey}`] = rec;

  if (!stats[providerKey]) stats[providerKey] = { total: 0, passed: 0 };
  stats[providerKey].total += 1;
  if (pass) stats[providerKey].passed += 1;
});

const results = Array.from(perPlace.values());

// ---------- summary ----------
const summaries = {};
let totalExec = 0,
  passedExec = 0;
for (const [prov, s] of Object.entries(stats)) {
  const failed = s.total - s.passed;
  const passRatePercent =
    s.total > 0 ? Number(((s.passed / s.total) * 100).toFixed(2)) : 0;
  summaries[`s_${prov}`] = {
    total: s.total,
    passed: s.passed,
    failed,
    passRatePercent,
  };
  totalExec += s.total;
  passedExec += s.passed;
}
const s_overall = {
  total: totalExec,
  passed: passedExec,
  failed: totalExec - passedExec,
  passRatePercent:
    totalExec > 0 ? Number(((passedExec / totalExec) * 100).toFixed(2)) : 0,
};

// ---------- FOUND lists (with ✓ for pass) ----------
const providers = Object.keys(stats).sort();

// per provider: found (has coords) and pass sets
const foundByProvider = {};
const passedByProvider = {};
providers.forEach((p) => {
  const found = new Set();
  const passed = new Set();
  results.forEach((r) => {
    const rec = r[`r_${p}`];
    if (hasCoords(rec)) {
      found.add(r.place);
      if (rec.pass) passed.add(r.place);
    }
  });
  foundByProvider[p] = Array.from(found).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  passedByProvider[p] = new Set(passed); // keep Set for quick check
});

// overall: found if ANY provider has coords; pass if ANY provider pass
const foundOverallSet = new Set();
const passedOverallSet = new Set();
results.forEach((r) => {
  let anyFound = false,
    anyPass = false;
  providers.forEach((p) => {
    const rec = r[`r_${p}`];
    if (hasCoords(rec)) {
      anyFound = true;
      if (rec.pass) anyPass = true;
    }
  });
  if (anyFound) foundOverallSet.add(r.place);
  if (anyPass) passedOverallSet.add(r.place);
});
const places_found_overall = Array.from(foundOverallSet).sort((a, b) =>
  a.localeCompare(b, undefined, { sensitivity: "base" })
);
const places_found_overall_marked = places_found_overall.map(
  (name) => name + (passedOverallSet.has(name) ? " ✓" : "")
);

// build marked per provider (add ✓ if that provider’s record passed)
const places_found_by_provider = {};
const places_found_by_provider_marked = {};
providers.forEach((p) => {
  const list = foundByProvider[p];
  places_found_by_provider[p] = list;
  places_found_by_provider_marked[p] = list.map(
    (name) => name + (passedByProvider[p].has(name) ? " ✓" : "")
  );
});

// ---------- save ----------
const summaryObj = {
  s_overall,
  ...summaries,
  places_found_overall,
  places_found_overall_marked, // with ✓
  places_found_by_provider,
  places_found_by_provider_marked, // with ✓
  results,
};
fs.mkdirSync(path.dirname(SUMMARY), { recursive: true });
fs.writeFileSync(SUMMARY, JSON.stringify(summaryObj, null, 2), "utf8");

// ---------- console ----------
const pad = (s, n) => String(s ?? "").padEnd(n);
const fmt = (x) =>
  x == null ? "-" : typeof x === "number" ? x.toFixed(2) : String(x);

console.log("\n📍 Places FOUND (apiLat/apiLng not null) — ✓ = pass criteria");
console.log("  Overall (" + places_found_overall_marked.length + "):");
if (places_found_overall_marked.length) {
  const cols = 4;
  for (let i = 0; i < places_found_overall_marked.length; i += cols) {
    console.log(
      "   - " + places_found_overall_marked.slice(i, i + cols).join(" | ")
    );
  }
} else {
  console.log("   (none)");
}
providers.forEach((p) => {
  const list = places_found_by_provider_marked[p] || [];
  console.log(`  ${p} (${list.length}):`);
  if (list.length) {
    const cols = 4;
    for (let i = 0; i < list.length; i += cols) {
      console.log("   - " + list.slice(i, i + cols).join(" | "));
    }
  } else {
    console.log("   (none)");
  }
});

console.log("\n📊 Accuracy Summary (per place, dynamic providers)");
let header = pad("Place", 30);
providers.forEach((p) => {
  header +=
    " " + pad(`${p}:dist(m)`, 14) + pad(`${p}:res`, 8) + pad(`${p}:code`, 8);
});
console.log(header);

results.forEach((r) => {
  let line = pad(r.place, 30);
  providers.forEach((p) => {
    const rec = r[`r_${p}`];
    const dist = fmt(rec?.distanceM ?? null);
    const res = rec ? (rec.pass ? "PASS" : "FAIL") : "-";
    const code = rec?.statusCode ?? "-";
    line += " " + pad(dist, 14) + pad(res, 8) + pad(code, 8);
  });
  console.log(line);
});

console.log("\n─────────────── Provider Summaries ───────────────");
providers.forEach((p) => {
  const s = summaries[`s_${p}`];
  console.log(
    `▶ s_${p}: total=${s.total}, passed=${s.passed}, failed=${s.failed}, passRate=${s.passRatePercent}%`
  );
});
console.log(
  `\n▶ s_overall: total=${s_overall.total}, passed=${s_overall.passed}, failed=${s_overall.failed}, passRate=${s_overall.passRatePercent}%`
);
console.log(`\n💾 Saved: ${SUMMARY}\n`);
