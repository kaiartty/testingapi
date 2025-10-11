const express = require("express");
const { getLatlongLongdo } = require("../controllers/locations");

const router = express.Router();

router.route("/").get(getLatlongLongdo);

module.exports = router;
