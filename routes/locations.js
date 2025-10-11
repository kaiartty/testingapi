const express = require("express");
const { getLatlongLongdo } = require("../controllers/locations");

const router = express.Router();

router.route("/longdo").get(getLatlongLongdo);


module.exports = router;
