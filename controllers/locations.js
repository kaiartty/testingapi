// controllers/location.controller.js
const axios = require("axios");

/* ----------------------------- helpers ----------------------------- */
function pick(val) {
  return val === undefined || val === null ? "" : String(val).trim();
}

function normalizeThaiAddressParts(q) {
  // map alias → ฟิลด์มาตรฐาน
  return {
    houseNumber: pick(q.houseNumber || q.number || q.no),
    street: pick(q.street || q.road || q.ถนน),
    alley: pick(q.alley || q.soi || q.ซอย),
    subdistrict: pick(q.subdistrict || q.subDist || q.แขวง || q.ตำบล),
    district: pick(q.district || q.dist || q.เขต || q.อำเภอ),
    province: pick(q.province || q.จังหวัด),
    postcode: pick(q.postcode || q.zip || q.postalcode || q.รหัสไปรษณีย์),
    country: pick(q.country || "th"),
  };
}

function buildFullTextFromParts(parts) {
  // ใช้กับ provider ที่ไม่รองรับ structured โดยตรง หรือ fallback
  const segs = [
    parts.houseNumber && `บ้านเลขที่ ${parts.houseNumber}`,
    parts.alley && `ซ.${parts.alley}`,
    parts.street && `ถ.${parts.street}`,
    parts.subdistrict && parts.subdistrict,
    parts.district && parts.district,
    parts.province && parts.province,
    parts.postcode && parts.postcode,
    parts.country && parts.country,
  ].filter(Boolean);
  return segs.join(" ");
}

function hasAnyAddressPart(parts) {
  return Object.entries(parts).some(
    ([k, v]) => k !== "country" && v && v.length > 0
  );
}

// --- params cleaner: ลบ key ที่ว่าง/undefined ออกจริง ๆ ก่อนยิง API ---
function cleanParams(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      out[k] = v;
    }
  }
  return out;
}

// --- ป้องกัน "ซ.ซอย ..." ซ้ำ ---
function sanitizeAlley(alley) {
  if (!alley) return "";
  let s = String(alley).trim();
  s = s.replace(/^(ซ\.?|ซอย)\s*/i, "");
  return s;
}

// --- keyword ที่เหมาะกับ Longdo (ไม่ใส่คำพ่วงเกินจำเป็น) ---
function buildLongdoKeyword(parts) {
  const alleyCore = sanitizeAlley(parts.alley);
  const segs = [
    parts.houseNumber && `${parts.houseNumber}`,
    alleyCore && `ซอย ${alleyCore}`,
    parts.street && `${parts.street}`,
    parts.subdistrict && parts.subdistrict,
    parts.district && parts.district,
    parts.province && parts.province,
    parts.postcode && parts.postcode,
    // country ไม่จำเป็นใน keyword
  ].filter(Boolean);
  return segs.join(" ");
}

// --- Longdo dataset allowlist ตามเอกสาร ---
const LONGDO_ALLOWED_DATASETS = new Set([
  "data2p",
  "data2r",
  "data2a",
  "data2b",
  "change",
  "con",
  "tag",
  "pg",
  "nw",
  "m2h",
  "bus",
  "osmpnt",
  "osmline",
  "osmpol",
  "overture2p",
]);
function parseDatasetCSV(input) {
  if (!input) return undefined;
  const items = String(input)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => LONGDO_ALLOWED_DATASETS.has(s));
  return items.length ? items.join(",") : undefined;
}

// user-agent กลาง (Nominatim ต้องมี UA)
const UA_HEADERS = {
  "User-Agent": "VacQ/1.0 (contact: youremail@example.com)",
  Accept: "application/json",
  "Accept-Language": "th",
};

/* ------------------------------- LONGDO ------------------------------- */
// @desc    Get Latitude and Longitude (Longdo Map API)
// @route   GET /api/v1/locations
// @access  Public
exports.getLatlongLongdo = async (req, res) => {
  try {
    const structured =
      String(req.query.structured || "").toLowerCase() === "true";

    // เตรียม keyword
    let place = req.query.place && String(req.query.place).trim();
    if (structured) {
      const parts = normalizeThaiAddressParts(req.query);
      if (!hasAnyAddressPart(parts) && !place) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide ?place=XXX or structured=true with address fields (houseNumber, street, district, province, postcode)",
        });
      }
      if (!place) place = buildLongdoKeyword(parts);
    }
    if (!place) {
      return res
        .status(400)
        .json({ success: false, message: "Please use ?place=XXX" });
    }

    const url = "https://search.longdo.com/mapsearch/json/search";
    const params = cleanParams({
      keyword: place,
      key: process.env.LONGDOMAP_API_KEY,
      area: req.query.area, // CSV ของ geocode โซน
      lon: req.query.lon, // bias center
      lat: req.query.lat,
      span: req.query.span, // "3km" / "0.05deg" ฯลฯ
      tag: req.query.tag, // CSV tag
      offset: req.query.offset,
      limit: req.query.limit || "5",
      dataset: parseDatasetCSV(req.query.dataset),
      locale: req.query.locale || "th",
    });

    const response = await axios.get(url, { params, timeout: 8000 });
    const arr = response?.data?.data;
    if (!Array.isArray(arr) || arr.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    const r0 = arr[0];
    const latlong = {
      lat: r0.lat,
      lng: r0.lon,
      name: r0.name,
      address: r0.address,
      provider: "longdo",
      queryMode: structured ? "structured->text" : "text",
      datasetUsed: params.dataset || null,
      meta: {
        hasmore: response?.data?.meta?.hasmore ?? undefined,
        start: response?.data?.meta?.start ?? undefined,
        end: response?.data?.meta?.end ?? undefined,
        keywordForwarded: params.keyword,
      },
    };

    return res.status(200).json({ success: true, data: latlong });
  } catch (err) {
    const status = err?.response?.status;
    const msg = status ? `Longdo error (HTTP ${status})` : "Longdo error";
    return res.status(400).json({ success: false, message: msg });
  }
};

/* ----------------------------- NOMINATIM ----------------------------- */
// @desc    Get Latitude and Longitude (Nominatim API)
// @route   GET /api/v1/locations/nominatim
// @access  Public
exports.getLatlongNominatim = async (req, res) => {
  try {
    const structured =
      String(req.query.structured || "").toLowerCase() === "true";
    const parts = normalizeThaiAddressParts(req.query);

    const url = "https://nominatim.openstreetmap.org/search";
    let params;

    if (structured && hasAnyAddressPart(parts)) {
      const streetCombo = [parts.houseNumber, parts.street]
        .filter(Boolean)
        .join(" ");
      const cityCombo = parts.district || parts.subdistrict || "";

      params = cleanParams({
        format: "jsonv2",
        addressdetails: "1",
        limit: "1",
        countrycodes: parts.country || "th",
        street: streetCombo,
        city: cityCombo,
        county: parts.district,
        state: parts.province,
        postalcode: parts.postcode,
      });
    } else {
      const place = req.query.place && String(req.query.place).trim();
      if (!place) {
        return res.status(400).json({
          success: false,
          message:
            "Please use ?place=XXX or structured=true with address fields (houseNumber, street, district, province, postcode)",
        });
      }
      params = cleanParams({
        q: place,
        format: "jsonv2",
        addressdetails: "1",
        limit: "1",
        countrycodes: "th",
      });
    }

    const response = await axios.get(url, {
      params,
      headers: UA_HEADERS,
      timeout: 8000,
    });

    let data = response.data;
    if (!Array.isArray(data) || data.length === 0) {
      if (structured) {
        const text = buildFullTextFromParts(parts);
        if (text) {
          const fb = await axios.get(url, {
            params: cleanParams({
              q: text,
              format: "jsonv2",
              addressdetails: "1",
              limit: "1",
              countrycodes: parts.country || "th",
            }),
            headers: UA_HEADERS,
            timeout: 8000,
          });
          data = fb.data;
        }
      }
    }

    if (!Array.isArray(data) || data.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    const r0 = data[0];
    const latlong = {
      lat: parseFloat(r0.lat),
      lng: parseFloat(r0.lon),
      name: r0.display_name,
      provider: "nominatim",
      queryMode: structured && hasAnyAddressPart(parts) ? "structured" : "text",
    };

    return res.status(200).json({ success: true, data: latlong });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403) {
      return res.status(403).json({
        success: false,
        message:
          "Access blocked by Nominatim (missing or invalid User-Agent / rate limit exceeded)",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Server error while fetching location (Nominatim)",
    });
  }
};

/* ---------------------------- LOCATIONIQ ---------------------------- */
// @desc    Get Latitude and Longitude (LocationIQ API)
// @route   GET /api/v1/locations/locationiq
// @access  Public
exports.getLatlongLocationIQ = async (req, res) => {
  try {
    const structured =
      String(req.query.structured || "").toLowerCase() === "true";
    const parts = normalizeThaiAddressParts(req.query);

    const url = "https://eu1.locationiq.com/v1/search";
    let params;

    if (structured && hasAnyAddressPart(parts)) {
      const streetCombo = [
        parts.houseNumber,
        parts.street,
        parts.alley && `ซ.${parts.alley}`,
      ]
        .filter(Boolean)
        .join(" ");

      params = cleanParams({
        key: process.env.LOCATIONIQ_API_KEY,
        format: "json",
        "accept-language": "th",
        limit: "1",
        street: streetCombo,
        city: parts.district || parts.subdistrict,
        county: parts.district,
        state: parts.province,
        postalcode: parts.postcode,
        countrycodes: parts.country || "th",
        normalizeaddress: "1",
      });
    } else {
      const place = req.query.place && String(req.query.place).trim();
      if (!place) {
        return res.status(400).json({
          success: false,
          message:
            "Please use ?place=XXX or structured=true with address fields (houseNumber, street, district, province, postcode)",
        });
      }
      params = cleanParams({
        key: process.env.LOCATIONIQ_API_KEY,
        q: place,
        format: "json",
        "accept-language": "th",
        limit: "1",
      });
    }

    const response = await axios.get(url, { params, timeout: 8000 });
    let data = response.data;

    if (!Array.isArray(data) || data.length === 0) {
      if (structured) {
        const text = buildFullTextFromParts(parts);
        if (text) {
          const fb = await axios.get(url, {
            params: cleanParams({
              key: process.env.LOCATIONIQ_API_KEY,
              q: text,
              format: "json",
              "accept-language": "th",
              limit: "1",
            }),
            timeout: 8000,
          });
          data = fb.data;
        }
      }
    }

    if (!Array.isArray(data) || data.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    const r0 = data[0];
    const latlong = {
      lat: parseFloat(r0.lat),
      lng: parseFloat(r0.lon),
      name: r0.display_name,
      provider: "locationiq",
      queryMode: structured && hasAnyAddressPart(parts) ? "structured" : "text",
    };

    return res.status(200).json({ success: true, data: latlong });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error while fetching location (LocationIQ)",
    });
  }
};

/* ------------------------------ GEOAPIFY ------------------------------ */
// @desc    Get Latitude and Longitude (Geoapify API)
// @route   GET /api/v1/locations/geoapify
// @access  Public
exports.getLatlongGeoapify = async (req, res) => {
  try {
    const structured =
      String(req.query.structured || "").toLowerCase() === "true";
    const parts = normalizeThaiAddressParts(req.query);

    const url = "https://api.geoapify.com/v1/geocode/search";
    let params;

    if (structured && hasAnyAddressPart(parts)) {
      params = cleanParams({
        apiKey: process.env.GEOAPIFY_API_KEY,
        format: "json",
        lang: "th",
        housenumber: parts.houseNumber,
        street: [parts.street, parts.alley && `ซ.${parts.alley}`]
          .filter(Boolean)
          .join(" "),
        city: parts.district || parts.subdistrict,
        county: parts.district,
        state: parts.province,
        postcode: parts.postcode,
        country: parts.country || "th",
        filter: `countrycode:${(parts.country || "th").toLowerCase()}`,
        bias: `countrycode:${(parts.country || "th").toLowerCase()}`,
        limit: "1",
      });
    } else {
      const place = req.query.place && String(req.query.place).trim();
      if (!place) {
        return res.status(400).json({
          success: false,
          message:
            "Please use ?place=XXX or structured=true with address fields (houseNumber, street, district, province, postcode)",
        });
      }
      params = cleanParams({
        text: place,
        apiKey: process.env.GEOAPIFY_API_KEY,
        lang: "th",
        limit: "1",
      });
    }

    const response = await axios.get(url, { params, timeout: 8000 });
    let features = response?.data?.features;

    if (!Array.isArray(features) || features.length === 0) {
      if (structured) {
        const text = buildFullTextFromParts(parts);
        if (text) {
          const fb = await axios.get(url, {
            params: cleanParams({
              text,
              apiKey: process.env.GEOAPIFY_API_KEY,
              lang: "th",
              limit: "1",
            }),
            timeout: 8000,
          });
          features = fb?.data?.features;
        }
      }
    }

    if (!Array.isArray(features) || features.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    const props = features[0].properties || {};
    const latlong = {
      lat: props.lat,
      lng: props.lon,
      name: props.name || props.formatted,
      confidence:
        props.rank && (props.rank.confidence || props.rank.importance),
      provider: "geoapify",
      queryMode: structured && hasAnyAddressPart(parts) ? "structured" : "text",
    };

    return res.status(200).json({ success: true, data: latlong });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error while fetching location (Geoapify)",
      error: err.message,
    });
  }
};

/* ------------------------------ OPENCAGE ------------------------------ */
// @desc    Get Latitude and Longitude (OpenCage API)
// @route   GET /api/v1/locations/opencage
// @access  Public
exports.getLatlongOpenCage = async (req, res) => {
  try {
    const structured =
      String(req.query.structured || "").toLowerCase() === "true";
    const parts = normalizeThaiAddressParts(req.query);

    const url = "https://api.opencagedata.com/geocode/v1/json";
    let params;

    if (structured && hasAnyAddressPart(parts)) {
      const text = buildFullTextFromParts(parts);
      const components = [
        parts.country && `country:${parts.country}`,
        parts.postcode && `postcode:${parts.postcode}`,
        parts.province && `state:${parts.province}`,
        parts.district && `city:${parts.district}`,
      ]
        .filter(Boolean)
        .join("|");

      params = cleanParams({
        q: text,
        key: process.env.OPENCAGE_API_KEY,
        language: "th",
        countrycode: (parts.country || "th").toLowerCase(),
        no_annotations: "1",
        limit: "1",
        components, // optional
      });
    } else {
      const place = req.query.place && String(req.query.place).trim();
      if (!place) {
        return res.status(400).json({
          success: false,
          message:
            "Please use ?place=XXX or structured=true with address fields (houseNumber, street, district, province, postcode)",
        });
      }
      params = cleanParams({
        q: place,
        key: process.env.OPENCAGE_API_KEY,
        language: "th",
        limit: "1",
        countrycode: "th",
        no_annotations: "1",
      });
    }

    const response = await axios.get(url, { params, timeout: 8000 });
    let results = response?.data?.results;

    if ((!Array.isArray(results) || results.length === 0) && structured) {
      const text = buildFullTextFromParts(parts);
      if (text) {
        const fb = await axios.get(url, {
          params: cleanParams({
            q: text,
            key: process.env.OPENCAGE_API_KEY,
            language: "th",
            limit: "1",
            countrycode: (parts.country || "th").toLowerCase(),
            no_annotations: "1",
          }),
          timeout: 8000,
        });
        results = fb?.data?.results;
      }
    }

    if (!Array.isArray(results) || results.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    const r0 = results[0];
    const latlong = {
      lat: r0?.geometry?.lat,
      lng: r0?.geometry?.lng,
      name: r0?.formatted,
      confidence: r0?.confidence,
      provider: "opencage",
      queryMode: structured && hasAnyAddressPart(parts) ? "structured" : "text",
    };

    return res.status(200).json({ success: true, data: latlong });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error while fetching location (OpenCage)",
    });
  }
};
