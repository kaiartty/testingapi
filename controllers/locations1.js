const axios = require("axios");

// @desc    Get Latitude and Longitude (Longdo Map API)
// @route   GET /api/v1/locations
// @access  Public
exports.getLatlongLongdo = async (req, res, next) => {
  try {
    const place = req.query.place;
    if (!place) {
      return res.status(400).json({
        success: false,
        message: "Please use ?place=XXX",
      });
    }

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
    };

    res.status(200).json({
      success: true,
      data: latlong,
    });
  } catch (err) {
    res.status(400).json({ success: false });
  }
};

// @desc    Get Latitude and Longitude (Nominatim API)
// @route   GET /api/v1/locations
// @access  Public
exports.getLatlongNominatim = async (req, res, next) => {
  try {
    const place = req.query.place;
    if (!place) {
      return res.status(400).json({
        success: false,
        message: "Please use ?place=XXX",
      });
    }

    const url = "https://nominatim.openstreetmap.org/search";
    const params = {
      q: place,
      format: "jsonv2",
      addressdetails: 1,
      limit: 1,
      countrycodes: "th",
    };

    const response = await axios.get(url, {
      params,
      headers: {
        "User-Agent": "MyApp/1.5 (contact: your_email@domain.com)", // ต้องมี
        Accept: "application/json",
        "Accept-Language": "th",
      },
      timeout: 8000,
    });

    if (!response.data || response.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    const result = response.data[0];
    const latlong = {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      name: result.display_name,
    };

    res.status(200).json({
      success: true,
      data: latlong,
    });
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

// @desc    Get Latitude and Longitude (LocationIQ API)
// @route   GET /api/v1/locations/locationiq
// @access  Public
exports.getLatlongLocationIQ = async (req, res, next) => {
  try {
    const place = req.query.place;
    if (!place) {
      return res.status(400).json({
        success: false,
        message: "Please use ?place=XXX",
      });
    }

    const url = "https://eu1.locationiq.com/v1/search";
    const params = {
      key: process.env.LOCATIONIQ_API_KEY,
      q: place,
      format: "json",
      "accept-language": "th",
      limit: 1,
    };

    const response = await axios.get(url, {
      params,
      timeout: 8000,
    });

    if (!response.data || response.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    const result = response.data[0];
    const latlong = {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      name: result.display_name,
    };

    res.status(200).json({
      success: true,
      data: latlong,
    });
  } catch (err) {
    console.error("LocationIQ Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching location (LocationIQ)",
    });
  }
};

// @desc    Get Latitude and Longitude (Geoapify API)
// @route   GET /api/v1/locations/geoapify
// @access  Public
exports.getLatlongGeoapify = async (req, res, next) => {
  try {
    const place = req.query.place; // รับ ?place=xxx จาก query string
    if (!place) {
      return res.status(400).json({
        success: false,
        message: "Please use ?place=XXX",
      });
    }

    // === URL ตรงกับ Postman format ===
    const url = "https://api.geoapify.com/v1/geocode/search";
    const params = {
      text: place, // ตรงกับ text ใน Postman
      apiKey: process.env.GEOAPIFY_API_KEY, // ใช้ key จาก env เหมือนในลิงก์ที่ให้มา
    };

    // === ยิง API ===
    const response = await axios.get(url, {
      params,
      timeout: 8000,
    });

    // === ตรวจว่ามีข้อมูลไหม ===
    if (
      !response.data ||
      !response.data.features ||
      response.data.features.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    // === แยกค่าจาก properties ===
    const props = response.data.features[0].properties;
    const latlong = {
      lat: props.lat,
      lng: props.lon,
      name: props.name || props.formatted,
    };

    // === ส่งกลับ ===
    res.status(200).json({
      success: true,
      data: latlong,
    });
  } catch (err) {
    console.error("Geoapify Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching location (Geoapify)",
      error: err.message,
    });
  }
};

// @desc    Get Latitude and Longitude (OpenCage API)
// @route   GET /api/v1/locations/opencage
// @access  Public
exports.getLatlongOpenCage = async (req, res, next) => {
  try {
    const place = req.query.place;
    if (!place) {
      return res.status(400).json({
        success: false,
        message: "Please use ?place=XXX",
      });
    }

    const url = "https://api.opencagedata.com/geocode/v1/json";
    const params = {
      q: place,
      key: process.env.OPENCAGE_API_KEY,
      language: "th",
      limit: 1,
    };

    const response = await axios.get(url, { params, timeout: 8000 });

    if (
      !response.data ||
      !response.data.results ||
      response.data.results.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    const result = response.data.results[0];
    const latlong = {
      lat: result.geometry.lat,
      lng: result.geometry.lng,
      name: result.formatted,
    };

    res.status(200).json({
      success: true,
      data: latlong,
    });
  } catch (err) {
    console.error("OpenCage Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching location (OpenCage)",
    });
  }
};
