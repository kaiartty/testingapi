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
