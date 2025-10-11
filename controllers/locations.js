// @desc    Get Latitude and Longitude
// @route   GET /api/v1/locations
// @access  Public
exports.getLatlong = async (req, res, next) => {
  try {
    const latlong = { lat: 40.7128, lng: -74.006 };
    res.status(200).json({
      success: true,
      data: latlong,
    });
  } catch (err) {
    res.status(400).json({ success: false });
  }
};
