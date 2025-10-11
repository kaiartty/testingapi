// test/summarize.js  (CommonJS, provider-agnostic)
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
  // 1) ตามโจทย์: ใช้ “ชื่อในวงเล็บ” ของ item เป็นหลัก เช่น "GET ... (longdo)"
  const byParen = nameInParens(ex.item?.name);
  if (byParen) return toKey(byParen);

  // 2) สำรอง: เดาจาก path .../locations/<provider>
  const u = ex.request && ex.request.url;
  const segs = u && Array.isArray(u.path) ? u.path.map(String.toString) : [];
  const i = segs.indexOf("locations");
  if (i >= 0 && segs[i + 1]) return toKey(segs[i + 1]);

  // 3) สำรองสุดท้าย: ชื่อ item ทั้งหมด
  const name = ex.item?.name || "unknown";
  return toKey(name);
}

function numOrNull(x) {
  return Number.isFinite(x) ? x : null;
}

// ---------- main ----------
if (!fs.existsSync(RESULT)) {
  console.error("❌ ไม่พบไฟล์:", RESULT);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(RESULT, "utf8"));
const executions = data.run?.executions || [];

// ต่อที่: per place (แผนที่ provider -> record)
const perPlace = new Map();
// stats ต่อ provider
const stats = Object.create(null);

executions.forEach((ex, idx) => {
  const h = headerMap(ex.request || {});
  const place = getPlaceFrom(ex, idx);
  const providerKey = getProviderKey(ex); // เช่น "longdo", "nominatim", "google", ...

  const refLat = parseFloat(h["x-ref-lat"]);
  const refLng = parseFloat(h["x-ref-lng"]);
  const threshold = parseFloat(h["x-threshold"]);

  // parse body
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

  // เก็บเป็น r_<providerKey>
  const rec = {
    refLat: numOrNull(refLat),
    refLng: numOrNull(refLng),
    apiLat: numOrNull(apiLat),
    apiLng: numOrNull(apiLng),
    passThresholdMeters: numOrNull(threshold),
    distanceM: Number.isFinite(distance) ? Number(distance.toFixed(2)) : null,
    pass,
  };
  row[`r_${providerKey}`] = rec;

  // stats
  if (!stats[providerKey]) stats[providerKey] = { total: 0, passed: 0 };
  stats[providerKey].total += 1;
  if (pass) stats[providerKey].passed += 1;
});

// เตรียมผล
const results = Array.from(perPlace.values());

// ทำสรุป s_<provider>
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

// ---------- เขียนไฟล์ ----------
const summaryObj = {
  s_overall,
  ...summaries, // <- ได้เป็น s_<provider> อัตโนมัติ
  results, // <- รายแถวเป็น r_<provider> อัตโนมัติ
};
fs.mkdirSync(path.dirname(SUMMARY), { recursive: true });
fs.writeFileSync(SUMMARY, JSON.stringify(summaryObj, null, 2), "utf8");

// ---------- แสดงบนคอนโซล ----------
const providers = Object.keys(stats).sort(); // เรียงชื่อ provider
const pad = (s, n) => String(s ?? "").padEnd(n);
const fmt = (x) =>
  x == null ? "-" : typeof x === "number" ? x.toFixed(2) : String(x);

console.log("\n📊 Accuracy Summary (per place, dynamic providers)");
let header = pad("Place", 30);
providers.forEach((p) => {
  header += " " + pad(`${p}:dist(m)`, 14) + pad(`${p}:res`, 8);
});
console.log(header);

results.forEach((r) => {
  let line = pad(r.place, 30);
  providers.forEach((p) => {
    const rec = r[`r_${p}`];
    line +=
      " " +
      pad(fmt(rec?.distanceM ?? null), 14) +
      pad(rec ? (rec.pass ? "PASS" : "FAIL") : "-", 8);
  });
  console.log(line);
});

console.log("\n─────────────── Provider Summaries ───────────────");
for (const p of providers) {
  const s = summaries[`s_${p}`];
  console.log(
    `▶ s_${p}: total=${s.total}, passed=${s.passed}, failed=${s.failed}, passRate=${s.passRatePercent}%`
  );
}
console.log(
  `\n▶ s_overall: total=${s_overall.total}, passed=${s_overall.passed}, failed=${s_overall.failed}, passRate=${s_overall.passRatePercent}%`
);
console.log(`\n💾 Saved: ${SUMMARY}\n`);
