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
        "User-Agent": "MyApp/1.0 (contact: your_email@domain.com)", // ต้องมี
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
      // type: result.type,
      // address: result.address || {},
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
