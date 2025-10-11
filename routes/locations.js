const express = require("express");
const {
  getLatlongLongdo,
  getLatlongNominatim,
} = require("../controllers/locations");

const router = express.Router();

router.route("/longdo").get(getLatlongLongdo);
router.route("/nominatim").get(getLatlongNominatim);

module.exports = router;
