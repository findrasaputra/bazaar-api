const db = require("../models");
const catalog = require("../services/catalog");
const wallet = require("../services/wallet");
const storage = require("../services/storage");
const audit = require("../middleware/audit");
const logger = require("../services/logger");

// Stores only move an order forward to processing and shipped. "delivered" comes
// from the delivery partner, "completed" from the buyer or the completion job.
const STORE_SETTABLE_STATUSES = {
  paid: ["processing"],
  processing: ["shipped"],
};
const MERCHANT_CANCELLABLE_STATUSES = ["paid", "processing", "cancel_requested"];
const STORE_EDITABLE_FIELDS = ["name"];
const PRODUCT_EDITABLE_FIELDS = ["name", "description", "price", "isActive"];
const CATALOG_PRODUCT_FIELDS = ["name", "description", "short_description", "regular_price", "sale_price", "stock_quantity"];
const STORE_ROLES = ["merchant", "staff"];

function positiveId(value) {
  const text = String(value);
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
}

// Platform admins act on every store; everyone else only on their own.
function storeScope(req) {
  return req.admin.role === "admin" ? {} : { merchantId: req.admin.merchantId };
}

function pick(body, fields) {
  const picked = {};
  for (const field of fields) {
    if (body && body[field] !== undefined) {
      picked[field] = body[field];
    }
  }
  return picked;
}

function toPrice(value) {
  const price = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

// Returns the validated product changes, or an error message.
function productChanges(body) {
  const changes = pick(body, PRODUCT_EDITABLE_FIELDS);
  if (!Object.keys(changes).length) {
    return { error: `Only ${PRODUCT_EDITABLE_FIELDS.join(", ")} can be updated` };
  }
  if (changes.name !== undefined && (typeof changes.name !== "string" || !changes.name.trim())) {
    return { error: "name must be a non-empty string" };
  }
  if (changes.description !== undefined && changes.description !== null && typeof changes.description !== "string") {
    return { error: "description must be a string" };
  }
  if (changes.price !== undefined) {
    changes.price = toPrice(changes.price);
    if (changes.price === null) {
      return { error: "price must be a number greater than zero" };
    }
  }
  if (changes.isActive !== undefined && typeof changes.isActive !== "boolean") {
    return { error: "isActive must be true or false" };
  }
  return { changes };
}

async function findOwnProduct(req) {
  const id = positiveId(req.params.id);
  return id ? db.product.findOne({ where: { id, merchantId: req.admin.merchantId } }) : null;
}

async function findProductVariation(req, product) {
  const id = positiveId(req.params.variationId);
  return id ? db.variation.findOne({ where: { id, productId: product.id } }) : null;
}

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
    let merchantId = req.admin.merchantId;
    if (req.query.store !== undefined) {
      const store = positiveId(req.query.store);
      if (!store) {
        return res.status(400).send({ message: "store must be a positive whole number" });
      }
      if (req.admin.role !== "admin" && store !== req.admin.merchantId) {
        return res.status(403).send({ message: "You can only view your own store's orders" });
      }
      merchantId = store;
    }
    const where = merchantId ? { merchantId } : {};
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
      where: { id: req.params.id, ...storeScope(req) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!order) {
      await t.rollback();
      return res.status(404).send({ message: "Order not found" });
    }

    const { status } = req.body;
    if (!(STORE_SETTABLE_STATUSES[order.status] || []).includes(status)) {
      await t.rollback();
      return res.status(400).send({ message: `Cannot change order from ${order.status} to ${status}` });
    }
    order.status = status;
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
      where: { id: req.params.id, ...storeScope(req) },
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
      where: { id: req.params.id, ...storeScope(req) },
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
    const product = await findOwnProduct(req);
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }
    const { changes, error } = productChanges(req.body);
    if (error) {
      return res.status(400).send({ message: error });
    }
    await product.update(changes);
    await audit.record(req, "product.update", "product", product.id, changes);
    res.send({ message: "Product updated" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const product = await findOwnProduct(req);
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }
    await product.destroy();
    await audit.record(req, "product.delete", "product", product.id, {});
    res.send({ message: "Product deleted" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.createVariation = async (req, res) => {
  try {
    const product = await findOwnProduct(req);
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }
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
    const product = await findOwnProduct(req);
    const variation = product && await findProductVariation(req, product);
    if (!variation) {
      return res.status(404).send({ message: "Variation not found" });
    }
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
    const product = await findOwnProduct(req);
    const variation = product && await findProductVariation(req, product);
    if (!variation) {
      return res.status(404).send({ message: "Variation not found" });
    }
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
    const { username, email } = req.body;
    if (typeof username !== "string" || !username.trim()) {
      return res.status(400).send({ message: "username is required" });
    }

    let role;
    let merchantId = null;
    if (req.admin.role === "admin") {
      role = req.body.roles ? req.body.roles[0] : "merchant";
      if (STORE_ROLES.includes(role)) {
        merchantId = positiveId(req.body.merchantId);
        if (!merchantId || !(await db.merchant.findByPk(merchantId))) {
          return res.status(400).send({ message: "A merchant or staff account needs an existing merchantId" });
        }
      }
    } else {
      // Store owners may only add staff to their own store.
      role = req.body.roles ? req.body.roles[0] : "staff";
      if (role !== "staff") {
        return res.status(403).send({ message: "You can only create staff accounts" });
      }
      if (req.body.merchantId !== undefined && positiveId(req.body.merchantId) !== req.admin.merchantId) {
        return res.status(403).send({ message: "You can only add staff to your own store" });
      }
      merchantId = req.admin.merchantId;
    }

    const admin = await db.adminUser.create({ username: username.trim(), email, role, merchantId });
    await audit.record(req, "admin.create", "adminUser", admin.id, { username: admin.username, role, merchantId });
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
    const id = positiveId(req.params.id);
    if (!id) {
      return res.status(400).send({ message: "Customer id must be a positive whole number" });
    }
    if (req.admin.role !== "admin") {
      // A store may only look up customers who ordered from it.
      const user = await db.appUser.findOne({ where: { catalogCustomerId: id } });
      const order = user && await db.order.findOne({ where: { userId: user.id, merchantId: req.admin.merchantId } });
      if (!order) {
        return res.status(404).send({ message: "Customer not found" });
      }
    }
    const { data } = await catalog.get(`/customers/${id}`);
    res.send(data);
  } catch (err) {
    res.status(err.response ? err.response.status : 500).send(err.response ? err.response.data : err.message);
  }
};

exports.updateCatalogProduct = async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    if (!id) {
      return res.status(400).send({ message: "Product id must be a positive whole number" });
    }
    const product = await db.product.findOne({ where: { catalogProductId: id, merchantId: req.admin.merchantId } });
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }
    const changes = pick(req.body, CATALOG_PRODUCT_FIELDS);
    if (!Object.keys(changes).length) {
      return res.status(400).send({ message: `Only ${CATALOG_PRODUCT_FIELDS.join(", ")} can be updated` });
    }
    const { data } = await catalog.put(`/products/${id}`, changes);
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
