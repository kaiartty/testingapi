// test/summarize.js  (CommonJS)
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
  // 1) จาก header ที่ encode ไว้
  if (h["x-place-enc"]) {
    try {
      return decodeURIComponent(h["x-place-enc"]);
    } catch {
      return h["x-place-enc"];
    }
  }
  // 2) จาก query ใน request URL
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
  // 3) ชื่อ item หรือ case#
  return ex.item?.name || `case#${idx + 1}`;
}

// ---------- main ----------
if (!fs.existsSync(RESULT)) {
  console.error("❌ ไม่พบไฟล์:", RESULT);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(RESULT, "utf8"));
const executions = data.run?.executions || [];
const out = [];

executions.forEach((ex, idx) => {
  const h = headerMap(ex.request || {});
  const place = getPlaceFrom(ex, idx);
  const refLat = parseFloat(h["x-ref-lat"]);
  const refLng = parseFloat(h["x-ref-lng"]);
  const threshold = parseFloat(h["x-threshold"]);

  // body -> api lat/lng
  let apiLat = NaN,
    apiLng = NaN;
  try {
    const buf = Buffer.from(ex.response?.stream?.data || []);
    const body = JSON.parse(buf.toString("utf8"));
    apiLat = Number(body?.data?.lat);
    apiLng = Number(body?.data?.lng);
  } catch (_) {}

  let distance = NaN;
  let pass = false;

  if ([apiLat, apiLng, refLat, refLng].every(Number.isFinite)) {
    distance = haversine(apiLat, apiLng, refLat, refLng);
    pass = Number.isFinite(threshold) ? distance <= threshold : false;
  }

  out.push({
    place,
    refLat: Number.isFinite(refLat) ? refLat : null,
    refLng: Number.isFinite(refLng) ? refLng : null,
    apiLat: Number.isFinite(apiLat) ? apiLat : null,
    apiLng: Number.isFinite(apiLng) ? apiLng : null,
    passThresholdMeters: Number.isFinite(threshold) ? threshold : null,
    "differenct(m)": Number.isFinite(distance)
      ? Number(distance.toFixed(2))
      : null,
    pass,
  });
});

// ---------- สรุปผลรวม ----------
const total = out.length;
thePassed = out.filter((r) => r.pass).length; // keep variable name consistent below
const passCount = thePassed;
const percent = total > 0 ? ((passCount / total) * 100).toFixed(2) : "0.00";

const summaryObj = {
  total,
  passed: passCount,
  failed: total - passCount,
  passRatePercent: Number(percent),
  results: out,
};

// ---------- เขียนไฟล์ ----------
fs.mkdirSync(path.dirname(SUMMARY), { recursive: true });
fs.writeFileSync(SUMMARY, JSON.stringify(summaryObj, null, 2), "utf8");

// ---------- แสดงบนคอนโซล ----------
const pad = (s, n) => String(s ?? "").padEnd(n);
console.log("\n📊 Accuracy Summary");
console.log(
  pad("Place", 30),
  pad("differenct(m)", 14),
  pad("Threshold", 10),
  "Result"
);
out.forEach((r) => {
  const dist = r["differenct(m)"] == null ? "-" : r["differenct(m)"].toFixed(2);
  const thr = r.passThresholdMeters ?? "-";
  const res = r.pass ? "✅ PASS" : "❌ FAIL";
  console.log(pad(r.place, 30), pad(dist, 14), pad(thr, 10), res);
});

// ✅ สรุปท้ายสุด
console.log("\n─────────────── Summary ───────────────");
console.log(`✅ Passed: ${passCount}/${total}  (${percent}%)`);
console.log(`💾 Saved: ${SUMMARY}`);
console.log("──────────────────────────────────────\n");
