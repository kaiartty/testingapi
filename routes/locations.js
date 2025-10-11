const express = require("express");
const { getLatlong } = require("../controllers/locations");

const router = express.Router();

router.route("/").get(getLatlong);

module.exports = router;
