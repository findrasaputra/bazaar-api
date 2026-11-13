const crypto = require("crypto");
const db = require("../models");
const catalog = require("../services/catalog");
const wallet = require("../services/wallet");
const { getUserId } = require("../middleware/authApp");
const config = require("../../config/business.config");

const ADDRESS_FIELDS = ["label", "recipient", "phone", "line1", "city", "postcode"];
const STAFF_CODE_MAX_FAILURES = 5;
const STAFF_CODE_WINDOW_MS = 15 * 60 * 1000;
// userId -> { count, resetAt }. Per process; enough to stop guessing from one account.
const staffCodeFailures = new Map();

// verifyToken has already resolved the caller from the auth service.
async function currentUser(req) {
  return req.appUser;
}

async function lockCurrentUser(req, transaction) {
  return db.appUser.findByPk(req.appUser.id, { transaction, lock: transaction.LOCK.UPDATE });
}

function positiveId(value) {
  const text = String(value);
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
}

// Returns the address fields to save, or an error message.
function addressFields(body) {
  const fields = {};
  for (const field of ADDRESS_FIELDS) {
    if (!body || body[field] === undefined) {
      continue;
    }
    if (body[field] !== null && typeof body[field] !== "string") {
      return { error: `${field} must be a string` };
    }
    fields[field] = body[field];
  }
  return { fields };
}

function staffCodeBlocked(userId) {
  const entry = staffCodeFailures.get(userId);
  if (entry && entry.resetAt <= Date.now()) {
    staffCodeFailures.delete(userId);
    return false;
  }
  return Boolean(entry && entry.count >= STAFF_CODE_MAX_FAILURES);
}

function recordStaffCodeFailure(userId) {
  const now = Date.now();
  const entry = staffCodeFailures.get(userId);
  if (entry && entry.resetAt > now) {
    entry.count++;
  } else {
    staffCodeFailures.set(userId, { count: 1, resetAt: now + STAFF_CODE_WINDOW_MS });
  }
}

function parseQuantity(value) {
  const quantity = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isInteger(quantity) && quantity >= 1 ? quantity : null;
}

exports.syncCustomer = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const user = await lockCurrentUser(req, t);
    if (user.catalogCustomerId) {
      await t.commit();
      return res.send(user);
    }
    const { data } = await catalog.post("/customers", {
      email: user.email,
      first_name: user.name,
      username: user.email,
      // Each account gets its own unguessable password; customers sign in to the
      // storefront through "forgot password".
      password: crypto.randomBytes(24).toString("base64url"),
    });
    user.catalogCustomerId = data.id;
    await user.save({ transaction: t });
    await t.commit();
    res.send(user);
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).send({ message: err.message });
  }
};

exports.getProducts = async (req, res) => {
  const page = parseInt(req.query.page) || 0;
  const size = parseInt(req.query.size) || 20;
  const products = await db.product.findAndCountAll({
    where: { isActive: true },
    include: [db.variation],
    limit: size,
    offset: page * size,
  });
  res.send(products);
};

exports.getProduct = async (req, res) => {
  const product = await db.product.findOne({
    where: { id: req.params.id, isActive: true },
    include: [db.variation, db.review],
  });
  if (!product) {
    return res.status(404).send({ message: "Product not found" });
  }
  res.send(product);
};

exports.getCart = async (req, res) => {
  try {
    const user = await currentUser(req);
    const items = await db.cartItem.findAll({ where: { userId: user.id }, raw: true });
    let total = 0;
    for (const item of items) {
      const product = await db.product.findByPk(item.productId);
      const { data } = await catalog.get(`/products/${product.catalogProductId}`);
      item.name = product.name;
      item.price = parseFloat(data.price);
      item.lineTotal = item.price * item.quantity;
      total += item.lineTotal;
    }
    res.send({ items, total });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.addToCart = async (req, res) => {
  const { productId, variationId } = req.body;
  const quantity = parseQuantity(req.body.quantity);
  if (!quantity) {
    return res.status(400).send({ message: "Quantity must be a whole number of at least 1" });
  }

  const t = await db.sequelize.transaction();
  try {
    const user = await lockCurrentUser(req, t);
    const product = await db.product.findByPk(productId, { transaction: t });
    if (!product || !product.isActive) {
      await t.rollback();
      return res.status(404).send({ message: "Product not found" });
    }
    let variation = null;
    if (variationId) {
      variation = await db.variation.findOne({ where: { id: variationId, productId: product.id }, transaction: t });
      if (!variation) {
        await t.rollback();
        return res.status(404).send({ message: "Variation not found" });
      }
    }

    const existing = await db.cartItem.findOne({
      where: { userId: user.id, productId, variationId: variationId || null },
      transaction: t,
    });
    const newQuantity = (existing ? existing.quantity : 0) + quantity;
    if (newQuantity > product.stock || (variation && newQuantity > variation.stock)) {
      await t.rollback();
      return res.status(400).send({ message: "Not enough stock" });
    }

    if (existing) {
      existing.quantity = newQuantity;
      await existing.save({ transaction: t });
      await t.commit();
      return res.send(existing);
    }

    const item = await db.cartItem.create({
      userId: user.id,
      productId,
      variationId,
      quantity,
      price: product.price,
    }, { transaction: t });
    await t.commit();
    res.send(item);
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).send({ message: err.message });
  }
};

exports.checkout = async (req, res) => {
  const { addressId, staffCode } = req.body;
  if (staffCode !== undefined && staffCode !== null && staffCode !== "" && typeof staffCode !== "string") {
    return res.status(400).send({ message: "Invalid staff code" });
  }
  if (staffCode && staffCodeBlocked(req.appUser.id)) {
    return res.status(429).send({ message: "Too many invalid staff codes, try again later" });
  }
  if (!positiveId(addressId)) {
    return res.status(400).send({ message: "A shipping address is required" });
  }

  const t = await db.sequelize.transaction();
  const reject = async (status, message) => {
    await t.rollback();
    return res.status(status).send({ message });
  };
  try {
    const user = await lockCurrentUser(req, t);

    // Sorted so concurrent checkouts lock product rows in the same order.
    const items = await db.cartItem.findAll({
      where: { userId: user.id },
      order: [["productId", "ASC"], ["variationId", "ASC"]],
      transaction: t,
    });
    if (!items.length) {
      return reject(400, "Cart is empty");
    }
    if (items.some((cartItem) => !parseQuantity(cartItem.quantity))) {
      return reject(400, "Cart contains an invalid quantity");
    }
    const address = await db.address.findOne({ where: { id: addressId, userId: user.id }, transaction: t });
    if (!address) {
      return reject(404, "Address not found");
    }
    let staff = null;
    if (staffCode) {
      staff = await db.staff.findOne({ where: { code: staffCode }, transaction: t });
      if (!staff) {
        recordStaffCodeFailure(user.id);
        return reject(400, "Invalid staff code");
      }
    }

    let shippingFee = config.shippingFee();
    // Lock the wallet before the products, the same order cancellations use.
    const balance = await wallet.getBalance(user.id, t);

    let subtotal = 0;
    let merchantId = null;
    const lineItems = [];
    const lines = [];
    const reserved = {};
    for (const cartItem of items) {
      const product = await db.product.findByPk(cartItem.productId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!product || !product.isActive) {
        return reject(400, "A product in your cart is no longer available");
      }
      if (merchantId !== null && product.merchantId !== merchantId) {
        return reject(400, "Products from different stores must be checked out separately");
      }
      merchantId = product.merchantId;

      reserved[product.id] = (reserved[product.id] || 0) + cartItem.quantity;
      if (reserved[product.id] > product.stock) {
        return reject(400, `Not enough stock for ${product.name}`);
      }
      let variation = null;
      if (cartItem.variationId) {
        variation = await db.variation.findOne({
          where: { id: cartItem.variationId, productId: product.id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!variation || cartItem.quantity > variation.stock) {
          return reject(400, `Not enough stock for ${product.name}`);
        }
      }

      const { data } = await catalog.get(`/products/${product.catalogProductId}`);
      const price = parseFloat(data.price);
      subtotal += price * cartItem.quantity;
      lineItems.push({ product_id: product.catalogProductId, quantity: cartItem.quantity, price: data.price });
      lines.push({ cartItem, product, variation, price });
    }

    if (staff) {
      shippingFee = 0;
    }
    const total = subtotal + shippingFee;
    if (!(total > 0)) {
      return reject(400, "Order total must be greater than zero");
    }
    if (balance < total) {
      return reject(400, "Insufficient balance");
    }

    for (const line of lines) {
      await line.product.decrement("stock", { by: line.cartItem.quantity, transaction: t });
      if (line.variation) {
        await line.variation.decrement("stock", { by: line.cartItem.quantity, transaction: t });
      }
    }

    const { data: catalogOrder } = await catalog.post("/orders", {
      customer_id: user.catalogCustomerId,
      line_items: lineItems,
      shipping: address,
      set_paid: true,
    });

    const order = await db.order.create({
      userId: user.id,
      merchantId,
      catalogOrderId: catalogOrder.id,
      status: "paid",
      subtotal,
      shippingFee,
      total,
      staffCode: staff ? staff.code : null,
      paidAt: new Date(),
    }, { transaction: t });

    for (const { cartItem, price } of lines) {
      await db.orderItem.create({
        orderId: order.id,
        productId: cartItem.productId,
        variationId: cartItem.variationId,
        quantity: cartItem.quantity,
        price,
      }, { transaction: t });
    }

    await wallet.hold(user.id, order.id, total, t);
    await db.cartItem.destroy({ where: { userId: user.id }, transaction: t });
    await t.commit();

    res.send(order);
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).send({ message: err.message });
  }
};

exports.getOrders = async (req, res) => {
  try {
    const user = await currentUser(req);
    const orders = await db.order.findAll({
      where: { userId: user.id },
      include: [db.orderItem],
      order: [["createdAt", "DESC"]],
    });
    res.send(orders);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.confirmReceived = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const user = await currentUser(req);
    const order = await db.order.findOne({
      where: { id: req.params.id, userId: user.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!order) {
      await t.rollback();
      return res.status(404).send({ message: "Order not found" });
    }
    if (order.status !== "delivered") {
      await t.rollback();
      return res.status(400).send({ message: "Order is not delivered yet" });
    }

    await wallet.capture(user.id, order.id, parseFloat(order.total), t);
    await wallet.grantBonus(user.id, order.id, Math.floor(order.total / 10), t);

    order.status = "completed";
    order.completedAt = new Date();
    await order.save({ transaction: t });
    await t.commit();
    await catalog.put(`/orders/${order.catalogOrderId}`, { status: "completed" });

    res.send(order);
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).send({ message: err.message });
  }
};

exports.requestCancel = async (req, res) => {
  try {
    const user = await currentUser(req);
    const order = await db.order.findOne({ where: { id: req.params.id, userId: user.id } });
    if (!order) {
      return res.status(404).send({ message: "Order not found" });
    }
    if (!["paid", "processing"].includes(order.status)) {
      return res.status(400).send({ message: "Order can no longer be cancelled" });
    }

    order.status = "cancel_requested";
    order.cancelReason = req.body.reason;
    await order.save();
    res.send(order);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.getProductsToBeReviewed = async (req, res) => {
  try {
    const user = await currentUser(req);
    const productFilter = req.query.product_id ? `AND oi."productId" = ${req.query.product_id}` : "";
    const [rows] = await db.sequelize.query(`
      SELECT DISTINCT p.id, p.name, o.id AS "orderId"
      FROM orders o
      JOIN order_items oi ON oi."orderId" = o.id
      JOIN products p ON p.id = oi."productId"
      LEFT JOIN reviews r ON r."orderId" = o.id AND r."productId" = p.id
      WHERE o."userId" = ${user.id}
        AND o.status = 'completed'
        AND r.id IS NULL
        ${productFilter}
    `);
    res.send(rows);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.createReview = async (req, res) => {
  try {
    const user = await currentUser(req);
    const { productId, orderId, rating, comment } = req.body;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).send({ message: "Rating must be a whole number from 1 to 5" });
    }

    const purchased = await db.orderItem.findOne({
      where: { orderId, productId },
      include: [{ model: db.order, where: { userId: user.id, status: "completed" } }],
    });
    if (!purchased) {
      return res.status(403).send({ message: "You can only review products from your completed orders" });
    }
    const reviewed = await db.review.findOne({ where: { userId: user.id, orderId, productId } });
    if (reviewed) {
      return res.status(409).send({ message: "You have already reviewed this product for this order" });
    }

    const review = await db.review.create({
      productId,
      orderId,
      userId: user.id,
      authorName: user.name,
      rating,
      comment,
    });

    const avg = await db.review.aggregate("rating", "avg", { where: { productId } });
    await db.product.update({ ratingAvg: avg }, { where: { id: productId } });
    res.send(review);
  } catch (err) {
    if (err instanceof db.Sequelize.UniqueConstraintError) {
      return res.status(409).send({ message: "You have already reviewed this product for this order" });
    }
    res.status(500).send({ message: err.message });
  }
};

exports.getAddresses = async (req, res) => {
  try {
    const user = await currentUser(req);
    const addresses = await db.address.findAll({ where: { userId: user.id } });
    res.send(addresses);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.getAddress = async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    const address = id && await db.address.findOne({ where: { id, userId: req.appUser.id } });
    if (!address) {
      return res.status(404).send({ message: "Address not found" });
    }
    res.send(address);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.createAddress = async (req, res) => {
  try {
    const user = await currentUser(req);
    const { fields, error } = addressFields(req.body);
    if (error) {
      return res.status(400).send({ message: error });
    }
    const address = await db.address.create({ ...fields, userId: user.id });
    res.send(address);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.updateAddress = async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    const address = id && await db.address.findOne({ where: { id, userId: req.appUser.id } });
    if (!address) {
      return res.status(404).send({ message: "Address not found" });
    }
    const { fields, error } = addressFields(req.body);
    if (error) {
      return res.status(400).send({ message: error });
    }
    if (!Object.keys(fields).length) {
      return res.status(400).send({ message: `Only ${ADDRESS_FIELDS.join(", ")} can be updated` });
    }
    await address.update(fields);
    res.send({ message: "Address updated" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.getWishlist = async (req, res) => {
  try {
    const user = await currentUser(req);
    const items = await db.wishlist.findAll({ where: { userId: user.id } });
    res.send(items);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.addWishlist = async (req, res) => {
  try {
    const user = await currentUser(req);
    const productId = positiveId(req.body.productId);
    if (!productId) {
      return res.status(400).send({ message: "productId must be a positive whole number" });
    }
    if (!(await db.product.findOne({ where: { id: productId, isActive: true } }))) {
      return res.status(404).send({ message: "Product not found" });
    }
    const item = await db.wishlist.create({ userId: user.id, productId });
    res.send(item);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.deleteWishlist = async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    const removed = id ? await db.wishlist.destroy({ where: { id, userId: req.appUser.id } }) : 0;
    if (!removed) {
      return res.status(404).send({ message: "Wishlist item not found" });
    }
    res.send({ message: "Removed from wishlist" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.logEvent = async (req, res) => {
  try {
    await db.appLog.create({
      userId: getUserId(req),
      event: req.body.event,
      ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      userAgent: req.headers["user-agent"],
    });
    res.send({ ok: true });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};
