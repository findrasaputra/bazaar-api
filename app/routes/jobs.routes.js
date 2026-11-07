const express = require("express");
const jobAuth = require("../middleware/jobAuth");
const controller = require("../controllers/jobs.controller");

const router = express.Router();

router.post("/complete-orders", jobAuth, controller.completeOrders);
router.post("/closing-14days", jobAuth, controller.closing14Days);
router.post("/export-analytics", jobAuth, controller.exportAnalytics);

module.exports = router;
