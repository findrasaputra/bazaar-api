const express = require("express");
const webhookAuth = require("../middleware/webhookAuth");
const controller = require("../controllers/webhook.controller");

const router = express.Router();

router.post("/product-updated", webhookAuth, controller.productUpdated);
router.post("/product-deleted", webhookAuth, controller.productDeleted);
router.post("/mapping-deleted", webhookAuth, controller.mappingDeleted);

module.exports = router;
