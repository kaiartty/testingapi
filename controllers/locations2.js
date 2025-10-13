const axios = require("axios");

// ------------------ helpers ------------------
function pick(val) {
  return val === undefined || val === null ? "" : String(val).trim();
}

function normalizeThaiAddressParts(q) {
  // รับชื่อฟิลด์จาก query แล้ว map ให้อยู่รูปเดียวกัน
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
  // ใช้เมื่อ provider ไม่รองรับ structured หรือเป็น fallback
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

// ------------------ LONGDO (keyword only, compose) ------------------
// @desc    Get Latitude and Longitude (Longdo Map API)
// @route   GET /api/v1/locations
// @access  Public
exports.getLatlongLongdo = async (req, res, next) => {
  try {
    const structured =
      String(req.query.structured || "").toLowerCase() === "true";

    let place = req.query.place;
    if (structured) {
      const parts = normalizeThaiAddressParts(req.query);
      if (!hasAnyAddressPart(parts) && !place) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide ?place=XXX or structured=true with address fields (houseNumber, street, district, province, postcode)",
        });
      }
      // Longdo ไม่มี structured params แยกชัดเจน → รวมเป็นข้อความเดียว
      place =
        place && place.trim().length ? place : buildFullTextFromParts(parts);
    }

    if (!place) {
      return res.status(400).json({
        success: false,
        message: "Please use ?place=XXX",
      });
    }

    console.log("Longdo search for:", place);
    const url = `https://search.longdo.com/mapsearch/json/search?keyword=${encodeURIComponent(
      place
    )}&key=${process.env.LONGDOMAP_API_KEY}&limit=1`;

    const response = await axios.get(url);

    if (
      !response.data ||
      !response.data.data ||
      response.data.data.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    const result = response.data.data[0];
    const latlong = {
      lat: result.lat,
      lng: result.lon,
      name: result.name,
      address: result.address,
      provider: "longdo",
      queryMode: structured ? "structured->text" : "text",
    };

    res.status(200).json({ success: true, data: latlong });
  } catch (err) {
    res.status(400).json({ success: false, message: "Longdo error" });
  }
};

// ------------------ NOMINATIM (supports structured) ------------------
// @desc    Get Latitude and Longitude (Nominatim API)
// @route   GET /api/v1/locations/nominatim
// @access  Public
exports.getLatlongNominatim = async (req, res, next) => {
  try {
    const structured =
      String(req.query.structured || "").toLowerCase() === "true";
    const parts = normalizeThaiAddressParts(req.query);

    const url = "https://nominatim.openstreetmap.org/search";
    let params;
    if (structured && hasAnyAddressPart(parts)) {
      // Nominatim: house number มักรวมไว้ใน street ได้ เช่น "123 ถนนสีลม"
      const streetCombo = [parts.houseNumber, parts.street]
        .filter(Boolean)
        .join(" ");
      const cityCombo = parts.district || parts.subdistrict || "";
      params = {
        format: "jsonv2",
        addressdetails: 1,
        limit: 1,
        countrycodes: parts.country,
        street: streetCombo || undefined,
        city: cityCombo || undefined,
        county: parts.district || undefined,
        state: parts.province || undefined,
        postalcode: parts.postcode || undefined,
      };
    } else {
      const place = req.query.place;
      if (!place) {
        return res.status(400).json({
          success: false,
          message:
            "Please use ?place=XXX or structured=true with address fields (houseNumber, street, district, province, postcode)",
        });
      }
      params = {
        q: place,
        format: "jsonv2",
        addressdetails: 1,
        limit: 1,
        countrycodes: "th",
      };
    }

    const response = await axios.get(url, {
      params,
      headers: {
        "User-Agent": "MyAppa/1.5 (contact: your_email@domain.com)",
        Accept: "application/json",
        "Accept-Language": "th",
      },
      timeout: 8000,
    });

    let data = response.data;
    if (!data || data.length === 0) {
      // fallback: ถ้า structured ไม่เจอ ลอง text
      if (structured) {
        const text = buildFullTextFromParts(parts);
        const fb = await axios.get(url, {
          params: {
            q: text,
            format: "jsonv2",
            addressdetails: 1,
            limit: 1,
            countrycodes: parts.country || "th",
          },
          headers: {
            "User-Agent": "MyApp/1.5 (contact: your_email@domain.com)",
            Accept: "application/json",
            "Accept-Language": "th",
          },
          timeout: 8000,
        });
        data = fb.data;
      }
    }

    if (!data || data.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    const result = data[0];
    const latlong = {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      name: result.display_name,
      provider: "nominatim",
      queryMode: structured && hasAnyAddressPart(parts) ? "structured" : "text",
    };

    res.status(200).json({ success: true, data: latlong });
  } catch (err) {
    console.error("Nominatim Error:", err.message);
    if (err.response && err.response.status === 403) {
      return res.status(403).json({
        success: false,
        message:
          "Access blocked by Nominatim (missing or invalid User-Agent / rate limit exceeded)",
      });
    }
    res.status(500).json({
      success: false,
      message: "Server error while fetching location",
    });
  }
};

// ------------------ LOCATIONIQ (supports structured) ------------------
// @desc    Get Latitude and Longitude (LocationIQ API)
// @route   GET /api/v1/locations/locationiq
// @access  Public
exports.getLatlongLocationIQ = async (req, res, next) => {
  try {
    const structured =
      String(req.query.structured || "").toLowerCase() === "true";
    const parts = normalizeThaiAddressParts(req.query);

    const url = "https://eu1.locationiq.com/v1/search";
    let params;
    if (structured && hasAnyAddressPart(parts)) {
      // LocationIQ รองรับ street/city/state/postalcode/countrycodes
      const streetCombo = [
        parts.houseNumber,
        parts.street,
        parts.alley && `ซ.${parts.alley}`,
      ]
        .filter(Boolean)
        .join(" ");

      params = {
        key: process.env.LOCATIONIQ_API_KEY,
        format: "json",
        "accept-language": "th",
        limit: 1,
        street: streetCombo || undefined,
        city: parts.district || parts.subdistrict || undefined,
        county: parts.district || undefined,
        state: parts.province || undefined,
        postalcode: parts.postcode || undefined,
        countrycodes: parts.country || "th",
        normalizeaddress: 1, // ให้ normalize ที่อยู่ (ถ้ารองรับ)
      };
    } else {
      const place = req.query.place;
      if (!place) {
        return res.status(400).json({
          success: false,
          message:
            "Please use ?place=XXX or structured=true with address fields (houseNumber, street, district, province, postcode)",
        });
      }
      params = {
        key: process.env.LOCATIONIQ_API_KEY,
        q: place,
        format: "json",
        "accept-language": "th",
        limit: 1,
      };
    }

    const response = await axios.get(url, { params, timeout: 8000 });

    let data = response.data;
    if (!data || data.length === 0) {
      if (structured) {
        const text = buildFullTextFromParts(parts);
        const fb = await axios.get(url, {
          params: {
            key: process.env.LOCATIONIQ_API_KEY,
            q: text,
            format: "json",
            "accept-language": "th",
            limit: 1,
          },
          timeout: 8000,
        });
        data = fb.data;
      }
    }

    if (!data || data.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    const result = data[0];
    const latlong = {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      name: result.display_name,
      provider: "locationiq",
      queryMode: structured && hasAnyAddressPart(parts) ? "structured" : "text",
    };

    res.status(200).json({ success: true, data: latlong });
  } catch (err) {
    console.error("LocationIQ Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching location (LocationIQ)",
    });
  }
};

// ------------------ GEOAPIFY (supports structured) ------------------
// @desc    Get Latitude and Longitude (Geoapify API)
// @route   GET /api/v1/locations/geoapify
// @access  Public
exports.getLatlongGeoapify = async (req, res, next) => {
  try {
    const structured =
      String(req.query.structured || "").toLowerCase() === "true";
    const parts = normalizeThaiAddressParts(req.query);

    const url = "https://api.geoapify.com/v1/geocode/search";
    let params;

    if (structured && hasAnyAddressPart(parts)) {
      params = {
        apiKey: process.env.GEOAPIFY_API_KEY,
        format: "json",
        lang: "th",
        // Geoapify รองรับฟิลด์แยก
        housenumber: parts.houseNumber || undefined,
        street:
          [parts.street, parts.alley && `ซ.${parts.alley}`]
            .filter(Boolean)
            .join(" ") || undefined,
        city: parts.district || parts.subdistrict || undefined,
        county: parts.district || undefined,
        state: parts.province || undefined,
        postcode: parts.postcode || undefined,
        country: parts.country || "th",
        filter: `countrycode:${(parts.country || "th").toLowerCase()}`,
        bias: `countrycode:${(parts.country || "th").toLowerCase()}`,
        limit: 1,
      };
    } else {
      const place = req.query.place;
      if (!place) {
        return res.status(400).json({
          success: false,
          message:
            "Please use ?place=XXX or structured=true with address fields (houseNumber, street, district, province, postcode)",
        });
      }
      params = {
        text: place,
        apiKey: process.env.GEOAPIFY_API_KEY,
        lang: "th",
        limit: 1,
      };
    }

    const response = await axios.get(url, { params, timeout: 8000 });

    let features = response.data && response.data.features;
    if (!features || features.length === 0) {
      if (structured) {
        const text = buildFullTextFromParts(parts);
        const fb = await axios.get(url, {
          params: {
            text,
            apiKey: process.env.GEOAPIFY_API_KEY,
            lang: "th",
            limit: 1,
          },
          timeout: 8000,
        });
        features = fb.data && fb.data.features;
      }
    }

    if (!features || features.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    const props = features[0].properties;
    const latlong = {
      lat: props.lat,
      lng: props.lon,
      name: props.name || props.formatted,
      confidence:
        props.rank && (props.rank.confidence || props.rank.importance),
      provider: "geoapify",
      queryMode: structured && hasAnyAddressPart(parts) ? "structured" : "text",
    };

    res.status(200).json({ success: true, data: latlong });
  } catch (err) {
    console.error("Geoapify Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching location (Geoapify)",
      error: err.message,
    });
  }
};

// ------------------ OPENCAGE (quasi-structured via components) ------------------
// @desc    Get Latitude and Longitude (OpenCage API)
// @route   GET /api/v1/locations/opencage
// @access  Public
exports.getLatlongOpenCage = async (req, res, next) => {
  try {
    const structured =
      String(req.query.structured || "").toLowerCase() === "true";
    const parts = normalizeThaiAddressParts(req.query);

    const url = "https://api.opencagedata.com/geocode/v1/json";
    let params;

    if (structured && hasAnyAddressPart(parts)) {
      // OpenCage รองรับ components filter บางส่วน + q เป็นข้อความหลัก
      const text = buildFullTextFromParts(parts);
      const comp = [
        parts.country && `country:${parts.country}`,
        parts.postcode && `postcode:${parts.postcode}`,
        parts.province && `state:${parts.province}`,
        parts.district && `city:${parts.district}`,
      ]
        .filter(Boolean)
        .join("|");

      params = {
        q: text,
        key: process.env.OPENCAGE_API_KEY,
        language: "th",
        countrycode: (parts.country || "th").toLowerCase(),
        no_annotations: 1,
        limit: 1,
        components: comp || undefined,
      };
    } else {
      const place = req.query.place;
      if (!place) {
        return res.status(400).json({
          success: false,
          message:
            "Please use ?place=XXX or structured=true with address fields (houseNumber, street, district, province, postcode)",
        });
      }
      params = {
        q: place,
        key: process.env.OPENCAGE_API_KEY,
        language: "th",
        limit: 1,
        countrycode: "th",
        no_annotations: 1,
      };
    }

    const response = await axios.get(url, { params, timeout: 8000 });

    let results = response.data && response.data.results;
    if ((!results || results.length === 0) && structured) {
      // fallback เป็น text ล้วน
      const text = buildFullTextFromParts(parts);
      const fb = await axios.get(url, {
        params: {
          q: text,
          key: process.env.OPENCAGE_API_KEY,
          language: "th",
          limit: 1,
          countrycode: (parts.country || "th").toLowerCase(),
          no_annotations: 1,
        },
        timeout: 8000,
      });
      results = fb.data && fb.data.results;
    }

    if (!results || results.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    const result = results[0];
    const latlong = {
      lat: result.geometry.lat,
      lng: result.geometry.lng,
      name: result.formatted,
      confidence: result.confidence,
      provider: "opencage",
      queryMode: structured && hasAnyAddressPart(parts) ? "structured" : "text",
    };

    res.status(200).json({ success: true, data: latlong });
  } catch (err) {
    console.error("OpenCage Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching location (OpenCage)",
    });
  }
};
