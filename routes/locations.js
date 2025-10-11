const express = require("express");
const {
  getLatlongLongdo,
  getLatlongNominatim,
  getLatlongLocationIQ,
  getLatlongGeoapify,
  getLatlongOpenCage,
} = require("../controllers/locations");

const router = express.Router();

router.route("/longdo").get(getLatlongLongdo);
router.route("/nominatim").get(getLatlongNominatim);
router.route("/locationiq").get(getLatlongLocationIQ);
router.route("/geoapify").get(getLatlongGeoapify);
router.route("/opencage").get(getLatlongOpenCage);

module.exports = router;
