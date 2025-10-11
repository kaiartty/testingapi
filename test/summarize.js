// test/summarize.js  (FOUND lists + inline ✅ mark + s_overall any-pass out of 88)
const fs = require("fs");
const path = require("path");

const RESULT = path.join(__dirname, "results", "result.json");
const SUMMARY = path.join(__dirname, "results", "summary.json");

// ---------- config ----------
const EXPECTED_PLACES = Number(process.env.EXPECTED_PLACES || 88); // เต็ม 88 ตามที่ต้องการ

// ---------- utils ----------
const toRad = (d) => (d * Math.PI) / 180;
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lat2 - lng1 + lng1 - lng1); // keep structure simple
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(toRad(lng2 - lng1) / 2) ** 2;
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

// ---------- per-provider summaries (เดิม) ----------
const summaries = {};
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
}

// ---------- overall (แบบ any-pass out of 88) ----------
const providers = Object.keys(stats).sort();

let passedPlaces = 0;
results.forEach((r) => {
  const anyPass = providers.some((p) => r[`r_${p}`]?.pass);
  if (anyPass) passedPlaces += 1;
});
const totalPlaces = EXPECTED_PLACES; // ใช้ 88 ตามโจทย์
const cappedPassed = Math.min(passedPlaces, totalPlaces);
const s_overall = {
  total: totalPlaces, // เต็ม 88
  passed: cappedPassed, // มีอย่างน้อย 1 ผู้ให้บริการ pass กี่อัน
  failed: totalPlaces - cappedPassed,
  passRatePercent:
    totalPlaces > 0
      ? Number(((cappedPassed / totalPlaces) * 100).toFixed(2))
      : 0,
};

// ---------- FOUND lists (inline ✅ mark) ----------
const MARK = "✅";

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
  passedByProvider[p] = new Set(passed);
});

// overall found/pass
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

// overall (with mark)
const places_found_overall = Array.from(foundOverallSet)
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  .map((name) => name + (passedOverallSet.has(name) ? MARK : ""));

// per provider (with mark)
const places_found_by_provider = {};
providers.forEach((p) => {
  const list = foundByProvider[p] || [];
  places_found_by_provider[p] = list.map(
    (name) => name + (passedByProvider[p].has(name) ? MARK : "")
  );
});

// ---------- save ----------
const summaryObj = {
  s_overall, // <- คิดแบบ any-pass out of 88
  ...summaries,
  places_found_overall,
  places_found_by_provider,
  results,
};
fs.mkdirSync(path.dirname(SUMMARY), { recursive: true });
fs.writeFileSync(SUMMARY, JSON.stringify(summaryObj, null, 2), "utf8");

// ---------- console ----------
const pad = (s, n) => String(s ?? "").padEnd(n);
const fmt = (x) =>
  x == null ? "-" : typeof x === "number" ? x.toFixed(2) : String(x);

console.log("\n📍 Places FOUND (apiLat/apiLng not null) — ✅ = pass criteria");
console.log(
  `  Overall any-pass: ${s_overall.passed}/${s_overall.total} (${s_overall.passRatePercent}%)`
);
if (places_found_overall.length) {
  const cols = 4;
  for (let i = 0; i < places_found_overall.length; i += cols) {
    console.log("   - " + places_found_overall.slice(i, i + cols).join(" | "));
  }
} else {
  console.log("   (none)");
}

providers.forEach((p) => {
  const list = places_found_by_provider[p] || [];
  console.log(`  ${p} (${list.length} found):`);
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
  `\n▶ s_overall(any-pass): total=${s_overall.total}, passed=${s_overall.passed}, failed=${s_overall.failed}, passRate=${s_overall.passRatePercent}%`
);
console.log(`\n💾 Saved: ${SUMMARY}\n`);
