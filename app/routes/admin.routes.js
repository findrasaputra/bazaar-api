const express = require("express");
const { authAdmin, allow } = require("../middleware/authAdmin");
const { checkRolesExisted, checkStatusValid } = require("../middleware/validators");
const upload = require("../middleware/upload");
const controller = require("../controllers/admin.controller");

const router = express.Router();

const anyRole = allow("admin", "merchant", "staff");

router.get("/dashboard", authAdmin, anyRole, controller.getDashboard);

router.get("/orders", authAdmin, anyRole, controller.getOrders);
router.put("/orders/:id/status", authAdmin, anyRole, checkStatusValid, controller.updateStatusOrder);
router.post("/orders/:id/approve-cancel", authAdmin, allow("admin", "merchant"), controller.approveCancel);
router.post("/orders/:id/cancel", authAdmin, allow("admin", "merchant"), controller.cancelOrder);

router.post("/products", authAdmin, allow("merchant"), controller.createProduct);
router.put("/products/:id", authAdmin, allow("merchant"), controller.updateProduct);
router.delete("/products/:id", authAdmin, allow("merchant"), controller.deleteProduct);

router.post("/products/:id/variations", authAdmin, allow("merchant"), controller.createVariation);
router.put("/products/:id/variations/:variationId", authAdmin, allow("merchant"), controller.updateVariation);
router.delete("/products/:id/variations/:variationId", authAdmin, allow("merchant"), controller.deleteVariation);

router.put("/stores/:id", authAdmin, allow("merchant"), controller.updateStore);
router.post("/admins", authAdmin, allow("admin", "merchant"), checkRolesExisted, controller.createAdmin);
// Authenticate before multer, so anonymous callers cannot stream files to disk.
router.post("/banners", authAdmin, allow("admin"), upload.array("images"), controller.uploadBanners);

router.get("/catalog/customers/:id", authAdmin, allow("admin", "merchant"), controller.getCatalogCustomer);
router.put("/catalog/products/:id", authAdmin, allow("merchant"), controller.updateCatalogProduct);

router.get("/app-logs", authAdmin, anyRole, controller.getAppLogs);
router.get("/customers/export", authAdmin, anyRole, controller.exportCustomers);

module.exports = router;
