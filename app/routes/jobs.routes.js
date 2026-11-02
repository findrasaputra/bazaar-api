const express = require("express");
const controller = require("../controllers/jobs.controller");

const router = express.Router();

router.post("/complete-orders", controller.completeOrders);
router.post("/closing-14days", controller.closing14Days);
router.post("/export-analytics", controller.exportAnalytics);

module.exports = router;
