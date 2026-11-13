const express = require("express");
const basicAuth = require("../middleware/basicAuth");
const db = require("../models");

const router = express.Router();

// The delivery partner sees only what it needs to deliver an order: no buyer,
// totals or staff code.
async function partnerView(order) {
  const items = order.orderItems || await db.orderItem.findAll({ where: { orderId: order.id } });
  const products = await db.product.findAll({ where: { id: items.map((item) => item.productId) } });
  const names = Object.fromEntries(products.map((product) => [product.id, product.name]));
  return {
    id: order.id,
    status: order.status,
    paidAt: order.paidAt,
    deliveredAt: order.deliveredAt,
    items: items.map((item) => ({
      productId: item.productId,
      name: names[item.productId] || null,
      variationId: item.variationId,
      quantity: item.quantity,
    })),
  };
}

router.get("/orders/:id", basicAuth, async (req, res) => {
  const order = await db.order.findByPk(req.params.id, { include: [db.orderItem] });
  if (!order) {
    return res.status(404).send({ message: "Order not found" });
  }
  res.send(await partnerView(order));
});

router.post("/orders/:id/delivered", basicAuth, async (req, res) => {
  try {
    const order = await db.order.findByPk(req.params.id);
    if (!order) {
      return res.status(404).send({ message: "Order not found" });
    }
    if (order.status !== "shipped") {
      return res.status(400).send({ message: `A ${order.status} order cannot be marked delivered` });
    }
    order.status = "delivered";
    order.deliveredAt = new Date();
    await order.save();
    res.send(await partnerView(order));
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

module.exports = router;
