const express = require("express");
const basicAuth = require("../middleware/basicAuth");
const db = require("../models");

const router = express.Router();

router.get("/orders/:id", basicAuth, async (req, res) => {
  const order = await db.order.findByPk(req.params.id, { include: [db.orderItem] });
  if (!order) {
    return res.status(404).send({ message: "Order not found" });
  }
  res.send(order);
});

router.post("/orders/:id/delivered", basicAuth, async (req, res) => {
  const order = await db.order.findByPk(req.params.id);
  order.status = "delivered";
  order.deliveredAt = new Date();
  await order.save();
  res.send(order);
});

module.exports = router;
