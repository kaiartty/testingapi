// @desc    Get Latitude and Longitude
// @route   GET /api/v1/locations
// @access  Public
exports.getLatlong = async (req, res, next) => {
  try {
    const place = req.query.place;
    if (!place) {
      return res.status(400).json({
        success: false,
        message: "Please use ?place=XXX",
      });
    }

    const latlong = { lat: 18.796143, lng: 98.979263 };
    res.status(200).json({
      success: true,
      data: latlong,
    });
  } catch (err) {
    res.status(400).json({ success: false });
  }
};
