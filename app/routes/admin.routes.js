const express = require("express");
const { authAdmin } = require("../middleware/authAdmin");
const { checkRolesExisted, checkStatusValid } = require("../middleware/validators");
const upload = require("../middleware/upload");
const controller = require("../controllers/admin.controller");

const router = express.Router();

router.get("/dashboard", authAdmin, controller.getDashboard);

router.get("/orders", authAdmin, controller.getOrders);
router.put("/orders/:id/status", authAdmin, checkStatusValid, controller.updateStatusOrder);
router.post("/orders/:id/approve-cancel", authAdmin, controller.approveCancel);
router.post("/orders/:id/cancel", authAdmin, controller.cancelOrder);

router.post("/products", authAdmin, controller.createProduct);
router.put("/products/:id", authAdmin, controller.updateProduct);
router.delete("/products/:id", authAdmin, controller.deleteProduct);

router.post("/products/:id/variations", controller.createVariation);
router.put("/products/:id/variations/:variationId", controller.updateVariation);
router.delete("/products/:id/variations/:variationId", controller.deleteVariation);

router.put("/stores/:id", authAdmin, controller.updateStore);
router.post("/admins", authAdmin, checkRolesExisted, controller.createAdmin);
router.post("/banners", upload.array("images"), authAdmin, controller.uploadBanners);

router.get("/catalog/customers/:id", authAdmin, controller.getCatalogCustomer);
router.put("/catalog/products/:id", authAdmin, controller.updateCatalogProduct);

router.get("/app-logs", controller.getAppLogs);
router.get("/customers/export", controller.exportCustomers);

module.exports = router;
