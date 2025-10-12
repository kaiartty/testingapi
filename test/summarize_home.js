// test/summarize_home.js
// (FOUND lists + inline ✅ mark + s_overall any-pass out of EXPECTED_PLACES)
const fs = require("fs");
const path = require("path");

const RESULT = path.join(__dirname, "results", "home_result.json");
const SUMMARY = path.join(__dirname, "results", "home_summary.json");

// ---------- config ----------
const EXPECTED_PLACES = Number(process.env.EXPECTED_PLACES || 15); // ตั้งจำนวนแถว CSV ที่คาดหวัง

// กำหนดลำดับ provider สำหรับการแสดงผล/ตาราง
const PREFERRED_ORDER = [
  "longdo",
  "nominatim",
  "locationiq",
  "geoapify",
  "opencage",
];

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
  // 1) from "(provider)" in item name if exists
  const byParen = nameInParens(ex.item?.name);
  if (byParen) return toKey(byParen);
  // 2) from URL path .../locations/{provider}
  const u = ex.request && ex.request.url;
  const segs =
    (u && Array.isArray(u.path) && u.path.map((s) => String(s))) || [];
  const i = segs.indexOf("locations");
  if (i >= 0 && segs[i + 1]) return toKey(segs[i + 1]);
  // 3) fallback: item name ("Longdo" -> "longdo")
  const name = ex.item?.name || "unknown";
  return toKey(name);
}
function numOrNull(x) {
  return Number.isFinite(x) ? x : null;
}
const hasCoords = (rec) =>
  rec && Number.isFinite(rec.apiLat) && Number.isFinite(rec.apiLng);

function readBodyLatLng(execution) {
  try {
    if (execution.response?.stream?.data) {
      const buf = Buffer.from(execution.response.stream.data);
      const body = JSON.parse(buf.toString("utf8"));
      return { lat: Number(body?.data?.lat), lng: Number(body?.data?.lng) };
    }
    if (execution.response?.body) {
      const body = JSON.parse(execution.response.body);
      return { lat: Number(body?.data?.lat), lng: Number(body?.data?.lng) };
    }
    if (execution.response?.text) {
      const body = JSON.parse(execution.response.text);
      return { lat: Number(body?.data?.lat), lng: Number(body?.data?.lng) };
    }
  } catch (_) {}
  return { lat: NaN, lng: NaN };
}

function sortProviders(keys) {
  const rank = (k) => {
    const i = PREFERRED_ORDER.indexOf(k);
    return i >= 0 ? i : PREFERRED_ORDER.length + 1;
  };
  return keys.slice().sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

// --- NEW: ชื่อจาก query (รองรับ structured=true) ---
function buildNameFromQuery(u) {
  if (!u || !Array.isArray(u.query)) return null;

  const qmap = {};
  u.query.forEach((o) => {
    if (o && o.key) qmap[o.key] = o.value || "";
  });

  const dec = (v) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };

  if (String(qmap["structured"] || "").toLowerCase() === "true") {
    const segs = [
      qmap["houseNumber"] && `บ้านเลขที่ ${dec(qmap["houseNumber"])}`,
      qmap["alley"] && `ซ.${dec(qmap["alley"])}`,
      qmap["street"] && `ถ.${dec(qmap["street"])}`,
      qmap["subdistrict"] && dec(qmap["subdistrict"]),
      qmap["district"] && dec(qmap["district"]),
      qmap["province"] && dec(qmap["province"]),
      qmap["postcode"] && dec(qmap["postcode"]),
      qmap["country"] && dec(qmap["country"]),
    ].filter(Boolean);
    const s = segs.join(" ");
    if (s.trim()) return s;
  }

  if (qmap["place"]) return dec(qmap["place"]);
  return null;
}

// --- UPDATED: ชื่อเคสจาก X-Case-Name > X-Place-Enc > query > item name ---
function getDisplayPlace(ex, idx) {
  const h = headerMap(ex.request || {});
  const caseName = h["x-case-name"];
  if (caseName && String(caseName).trim()) return String(caseName).trim();

  if (h["x-place-enc"]) {
    try {
      return decodeURIComponent(h["x-place-enc"]);
    } catch {
      return h["x-place-enc"];
    }
  }
  const u = ex.request && ex.request.url;
  const built = buildNameFromQuery(u);
  if (built && built.trim()) return built.trim();

  return ex.item?.name || `case#${idx + 1}`;
}

// ---------- main ----------
if (!fs.existsSync(RESULT)) {
  console.error("❌ ไม่พบไฟล์:", RESULT);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(RESULT, "utf8"));
const executions = data.run?.executions || [];

const perCase = new Map(); // key: `${iteration}::${displayPlace}`
const stats = Object.create(null);
const iterationSet = new Set();

executions.forEach((ex, idx) => {
  const h = headerMap(ex.request || {});
  const displayPlace = getDisplayPlace(ex, idx);
  const providerKey = getProviderKey(ex);
  const refLat = parseFloat(h["x-ref-lat"]);
  const refLng = parseFloat(h["x-ref-lng"]);
  const threshold = parseFloat(h["x-threshold"]);
  const statusCode = ex.response?.code ?? null;

  const iter =
    ex.cursor && Number.isFinite(ex.cursor.iteration)
      ? ex.cursor.iteration
      : idx;
  iterationSet.add(iter);

  const { lat: apiLatRaw, lng: apiLngRaw } = readBodyLatLng(ex);
  const apiLat = Number(apiLatRaw);
  const apiLng = Number(apiLngRaw);

  let distance = NaN,
    pass = false;
  if ([apiLat, apiLng, refLat, refLng].every(Number.isFinite)) {
    distance = haversine(apiLat, apiLng, refLat, refLng);
    pass = Number.isFinite(threshold) ? distance <= threshold : false;
  }

  const key = `${iter}::${displayPlace}`;
  if (!perCase.has(key)) perCase.set(key, { displayPlace, iter });
  const row = perCase.get(key);

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

const results = Array.from(perCase.values());

// ---------- per-provider summaries ----------
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

// ---------- overall (any-pass out of EXPECTED_PLACES or iterations count) ----------
let providers = Object.keys(stats);
providers = sortProviders(providers);

// นับบ้านที่ “มีอย่างน้อย 1 provider ผ่าน” ต่อ 1 แถว CSV (iteration)
let passedCases = 0;
results.forEach((r) => {
  const anyPass = providers.some((p) => r[`r_${p}`]?.pass);
  if (anyPass) passedCases += 1;
});

// default รวม = จำนวน iteration พบจริง; แต่ให้เคารพ EXPECTED_PLACES ถ้าตั้งไว้
const totalCasesDetected = iterationSet.size;
const total = Number.isFinite(EXPECTED_PLACES)
  ? EXPECTED_PLACES
  : totalCasesDetected;
const passedCapped = Math.min(passedCases, total);

const s_overall = {
  total,
  passed: passedCapped,
  failed: total - passedCapped,
  passRatePercent:
    total > 0 ? Number(((passedCapped / total) * 100).toFixed(2)) : 0,
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
      found.add(r.displayPlace);
      if (rec.pass) passed.add(r.displayPlace);
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
  if (anyFound) foundOverallSet.add(r.displayPlace);
  if (anyPass) passedOverallSet.add(r.displayPlace);
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
  s_overall, // any-pass out of EXPECTED_PLACES (หรือ iterations)
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

console.log("\n📊 Accuracy Summary (per place)");
let header = pad("Place", 40);
providers.forEach((p) => {
  header +=
    " " + pad(`${p}:dist(m)`, 14) + pad(`${p}:res`, 8) + pad(`${p}:code`, 8);
});
console.log(header);

results
  .sort((a, b) => a.iter - b.iter)
  .forEach((r) => {
    let line = pad(r.displayPlace, 40);
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
