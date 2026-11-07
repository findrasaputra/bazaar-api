const db = require("../models");
const catalog = require("../services/catalog");
const wallet = require("../services/wallet");
const storage = require("../services/storage");
const audit = require("../middleware/audit");
const logger = require("../services/logger");

const NEXT_STATUSES = {
  paid: ["processing"],
  processing: ["shipped"],
  shipped: ["delivered"],
  delivered: ["completed"],
};
const MERCHANT_CANCELLABLE_STATUSES = ["paid", "processing", "cancel_requested"];
const STORE_EDITABLE_FIELDS = ["name"];

async function restockProduct(orderId, transaction) {
  // Sorted so concurrent restocks and checkouts lock product rows in the same order.
  const items = await db.orderItem.findAll({
    where: { orderId },
    order: [["productId", "ASC"], ["variationId", "ASC"]],
    transaction,
  });
  for (const line of items) {
    const product = await db.product.findByPk(line.productId, { transaction });
    if (product) {
      await product.increment("stock", { by: line.quantity, transaction });
    }

    if (line.variationId) {
      const variation = await db.variation.findByPk(line.variationId, { transaction });
      if (variation) {
        await variation.increment("stock", { by: line.quantity, transaction });
      } else {
        logger.warn(`variation ${line.variationId} not found, restock skipped`);
      }
    }
  }
}

exports.getDashboard = async (req, res) => {};

exports.getOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const size = parseInt(req.query.size) || 50;
    const where = { merchantId: req.query.store || req.admin.merchantId };
    if (req.query.status) {
      where.status = req.query.status;
    }
    const orders = await db.order.findAndCountAll({
      where,
      include: [db.orderItem],
      limit: size,
      offset: page * size,
      order: [["createdAt", "DESC"]],
    });
    res.send(orders);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.updateStatusOrder = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const order = await db.order.findOne({
      where: { id: req.params.id, merchantId: req.admin.merchantId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!order) {
      await t.rollback();
      return res.status(404).send({ message: "Order not found" });
    }

    const { status } = req.body;
    if (!(NEXT_STATUSES[order.status] || []).includes(status)) {
      await t.rollback();
      return res.status(400).send({ message: `Cannot change order from ${order.status} to ${status}` });
    }
    order.status = status;
    if (status === "delivered") {
      order.deliveredAt = new Date();
    }
    if (status === "completed") {
      order.completedAt = new Date();
      await wallet.capture(order.userId, order.id, parseFloat(order.total), t);
      await wallet.grantBonus(order.userId, order.id, Math.floor(order.total / 10), t);
    }
    await order.save({ transaction: t });
    await t.commit();

    await catalog.put(`/orders/${order.catalogOrderId}`, { status });
    await audit.record(req, "order.status", "order", order.id, { status });
    res.send(order);
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).send({ message: err.message });
  }
};

exports.approveCancel = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const order = await db.order.findOne({
      where: { id: req.params.id, merchantId: req.admin.merchantId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!order) {
      await t.rollback();
      return res.status(404).send({ message: "Order not found" });
    }
    if (order.status !== "cancel_requested") {
      await t.rollback();
      return res.status(400).send({ message: "No cancellation requested" });
    }

    await wallet.refund(order.userId, order.id, parseFloat(order.total), t);
    order.status = "cancelled";
    await order.save({ transaction: t });
    await restockProduct(order.id, t);
    await t.commit();

    await catalog.put(`/orders/${order.catalogOrderId}`, { status: "cancelled" });
    await audit.record(req, "order.approveCancel", "order", order.id, {});
    res.send(order);
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).send({ message: err.message });
  }
};

exports.cancelOrder = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const order = await db.order.findOne({
      where: { id: req.params.id, merchantId: req.admin.merchantId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!order) {
      await t.rollback();
      return res.status(404).send({ message: "Order not found" });
    }
    if (!MERCHANT_CANCELLABLE_STATUSES.includes(order.status)) {
      await t.rollback();
      return res.status(400).send({ message: `A ${order.status} order cannot be cancelled` });
    }

    await wallet.refund(order.userId, order.id, parseFloat(order.total), t);
    order.status = "cancelled";
    await order.save({ transaction: t });
    await restockProduct(order.id, t);
    await t.commit();

    await catalog.put(`/orders/${order.catalogOrderId}`, { status: "cancelled" });
    await audit.record(req, "order.cancel", "order", order.id, {});
    res.send(order);
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).send({ message: err.message });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const { name, description, price, stock } = req.body;
    const { data } = await catalog.post("/products", { name, description, regular_price: String(price), stock_quantity: stock });
    const product = await db.product.create({
      merchantId: req.admin.merchantId,
      catalogProductId: data.id,
      name,
      description,
      price,
      stock,
    });

    await audit.record(req, "product.create", "product", product.id, req.body);
    res.send(product);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    await db.product.update(req.body, { where: { id: req.params.id } });
    await audit.record(req, "product.update", "product", req.params.id, req.body);
    res.send({ message: "Product updated" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    await db.product.destroy({ where: { id: req.params.id } });
    await audit.record(req, "product.delete", "product", req.params.id, {});
    res.send({ message: "Product deleted" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.createVariation = async (req, res) => {
  try {
    const product = await db.product.findByPk(req.params.id);
    const { data } = await catalog.post(`/products/${product.catalogProductId}/variations`, {
      regular_price: String(req.body.price),
      stock_quantity: req.body.stock,
      attributes: [{ name: "Option", option: req.body.name }],
    });
    const variation = await db.variation.create({
      productId: product.id,
      catalogVariationId: data.id,
      name: req.body.name,
      price: req.body.price,
      stock: req.body.stock,
    });
    res.send(variation);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.updateVariation = async (req, res) => {
  try {
    const product = await db.product.findByPk(req.params.id);
    const variation = await db.variation.findByPk(req.params.variationId);
    await catalog.put(`/products/${product.catalogProductId}/variations/${variation.catalogVariationId}`, {
      regular_price: String(req.body.price),
      stock_quantity: req.body.stock,
    });
    variation.price = req.body.price;
    variation.stock = req.body.stock;
    await variation.save();
    res.send(variation);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.deleteVariation = async (req, res) => {
  try {
    const product = await db.product.findByPk(req.params.id);
    const variation = await db.variation.findByPk(req.params.variationId);
    await catalog.delete(`/products/${product.catalogProductId}/variations/${variation.catalogVariationId}`);
    await variation.destroy();
    res.send({ message: "Variation deleted" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.updateStore = async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.admin.merchantId)) {
      return res.status(403).send({ message: "You can only edit your own store" });
    }
    const changes = {};
    for (const field of STORE_EDITABLE_FIELDS) {
      if (req.body[field] === undefined) {
        continue;
      }
      if (typeof req.body[field] !== "string" || !req.body[field].trim()) {
        return res.status(400).send({ message: `${field} must be a non-empty string` });
      }
      changes[field] = req.body[field].trim();
    }
    if (!Object.keys(changes).length) {
      return res.status(400).send({ message: `Only ${STORE_EDITABLE_FIELDS.join(", ")} can be updated` });
    }

    await db.merchant.update(changes, { where: { id: req.params.id } });
    await audit.record(req, "store.update", "merchant", req.params.id, changes);
    res.send({ message: "Store updated" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.createAdmin = async (req, res) => {
  try {
    const admin = await db.adminUser.create({
      username: req.body.username,
      email: req.body.email,
      role: req.body.roles ? req.body.roles[0] : "merchant",
      merchantId: req.body.merchantId,
    });
    await audit.record(req, "admin.create", "adminUser", admin.id, req.body);
    res.send(admin);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.uploadBanners = async (req, res) => {
  try {
    const urls = [];
    for (const file of req.files) {
      urls.push(await storage.uploadFile(file, "banners"));
    }
    res.send({ urls });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.getCatalogCustomer = async (req, res) => {
  try {
    const { data } = await catalog.get(`/customers/${req.params.id}`);
    res.send(data);
  } catch (err) {
    res.status(err.response ? err.response.status : 500).send(err.response ? err.response.data : err.message);
  }
};

exports.updateCatalogProduct = async (req, res) => {
  try {
    const { data } = await catalog.put(`/products/${req.params.id}`, req.body);
    res.send(data);
  } catch (err) {
    res.status(err.response ? err.response.status : 500).send(err.response ? err.response.data : err.message);
  }
};

exports.getAppLogs = async (req, res) => {
  try {
    const logs = await db.appLog.findAll({ order: [["createdAt", "DESC"]] });
    res.send(logs);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.exportCustomers = async (req, res) => {
  try {
    const customers = await db.appUser.findAll();
    res.send(customers);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};
