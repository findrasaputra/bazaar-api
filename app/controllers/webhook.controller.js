const db = require("../models");

exports.productUpdated = async (req, res) => {
  const payload = req.body;
  const product = await db.product.findOne({ where: { catalogProductId: payload.id } });
  if (product) {
    product.price = payload.price;
    product.stock = payload.stock_quantity;
    product.isActive = payload.status === "publish";
    await product.save();
    await db.cartItem.update({ price: payload.price }, { where: { productId: product.id } });
  }
  res.send({ received: true });
};

exports.productDeleted = async (req, res) => {
  await db.product.update({ isActive: false }, { where: { catalogProductId: req.body.id } });
  res.send({ received: true });
};

exports.mappingDeleted = async (req, res) => {
  const product = await db.product.findOne({ where: { catalogProductId: req.body.product_id } });
  await db.recoMapping.destroy({ where: { productId: product.id } });
  res.send({ received: true });
};
