const express = require("express");
const controller = require("../controllers/webhook.controller");

const router = express.Router();

router.post("/product-updated", controller.productUpdated);
router.post("/product-deleted", controller.productDeleted);
router.post("/mapping-deleted", controller.mappingDeleted);

module.exports = router;
