const express = require("express");
const { verifyToken, optionalToken } = require("../middleware/authApp");
const controller = require("../controllers/app.controller");

const router = express.Router();

router.get("/products", controller.getProducts);
router.get("/products/:id", controller.getProduct);

router.post("/customer/sync", verifyToken, controller.syncCustomer);

router.get("/cart", verifyToken, controller.getCart);
router.post("/cart", verifyToken, controller.addToCart);
router.post("/checkout", verifyToken, controller.checkout);

router.get("/orders", verifyToken, controller.getOrders);
router.post("/orders/:id/received", verifyToken, controller.confirmReceived);
router.post("/orders/:id/cancel", verifyToken, controller.requestCancel);

router.get("/reviews/pending", verifyToken, controller.getProductsToBeReviewed);
router.post("/reviews", verifyToken, controller.createReview);

router.get("/addresses", verifyToken, controller.getAddresses);
router.post("/addresses", verifyToken, controller.createAddress);
router.get("/addresses/:id", verifyToken, controller.getAddress);
router.put("/addresses/:id", verifyToken, controller.updateAddress);

router.get("/wishlist", verifyToken, controller.getWishlist);
router.post("/wishlist", verifyToken, controller.addWishlist);
router.delete("/wishlist/:id", verifyToken, controller.deleteWishlist);

router.post("/logs", optionalToken, controller.logEvent);

module.exports = router;
