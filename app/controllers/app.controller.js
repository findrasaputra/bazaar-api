const db = require("../models");
const catalog = require("../services/catalog");
const wallet = require("../services/wallet");
const { getUserId } = require("../middleware/authApp");

const Op = db.Sequelize.Op;

async function currentUser(req) {
  return db.appUser.findOne({ where: { externalId: getUserId(req) } });
}

exports.syncCustomer = async (req, res) => {
  try {
    const user = await currentUser(req);
    if (user.catalogCustomerId) {
      return res.send(user);
    }
    const { data } = await catalog.post("/customers", {
      email: user.email,
      first_name: user.name,
      username: user.email,
      password: "default",
    });
    user.catalogCustomerId = data.id;
    await user.save();
    res.send(user);
  } catch (err) {
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
  const product = await db.product.findByPk(req.params.id, { include: [db.variation, db.review] });
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
    for (item of items) {
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
  try {
    const user = await currentUser(req);
    const { productId, variationId, quantity } = req.body;
    const product = await db.product.findByPk(productId);
    if (!product || !product.isActive) {
      return res.status(404).send({ message: "Product not found" });
    }

    const existing = await db.cartItem.findOne({
      where: { userId: user.id, productId, variationId: variationId || null },
    });
    if (existing) {
      existing.quantity = existing.quantity + quantity;
      await existing.save();
      return res.send(existing);
    }

    const item = await db.cartItem.create({
      userId: user.id,
      productId,
      variationId,
      quantity,
      price: product.price,
    });
    res.send(item);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.checkout = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const user = await currentUser(req);
    const { addressId, staffCode } = req.body;

    const items = await db.cartItem.findAll({ where: { userId: user.id }, transaction: t });
    if (!items.length) {
      await t.rollback();
      return res.status(400).send({ message: "Cart is empty" });
    }

    let subtotal = 0;
    let merchantId = null;
    const lineItems = [];
    for (cartItem of items) {
      const product = await db.product.findByPk(cartItem.productId, { transaction: t });
      const { data } = await catalog.get(`/products/${product.catalogProductId}`);
      subtotal += parseFloat(data.price) * cartItem.quantity;
      merchantId = product.merchantId;
      lineItems.push({ product_id: product.catalogProductId, quantity: cartItem.quantity, price: data.price });
    }

    let shippingFee = parseFloat(process.env.SHIPPING_FEE);
    let staff = null;
    if (staffCode) {
      staff = await db.staff.findOne({ where: { code: { [Op.iLike]: staffCode } }, transaction: t });
      if (staff) {
        shippingFee = 0;
      }
    }
    const total = subtotal + shippingFee;

    const balance = await wallet.getBalance(user.id);
    if (balance < total) {
      await t.rollback();
      return res.status(400).send({ message: "Insufficient balance" });
    }

    const address = await db.address.findByPk(addressId, { transaction: t });
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
      status: staff ? "completed" : "paid",
      subtotal,
      shippingFee,
      total,
      staffCode: staff ? staff.code : null,
      paidAt: new Date(),
      completedAt: staff ? new Date() : null,
    }, { transaction: t });

    for (cartItem of items) {
      await db.orderItem.create({
        orderId: order.id,
        productId: cartItem.productId,
        variationId: cartItem.variationId,
        quantity: cartItem.quantity,
        price: cartItem.price,
      }, { transaction: t });
    }
    await t.commit();

    await wallet.hold(user.id, order.id, total);
    if (staff) {
      await wallet.capture(user.id, order.id, total);
      await wallet.grantBonus(user.id, order.id, Math.floor(total / 10));
    }
    await db.cartItem.destroy({ where: { userId: user.id } });

    res.send(order);
  } catch (err) {
    await t.rollback();
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
  try {
    const user = await currentUser(req);
    const order = await db.order.findOne({ where: { id: req.params.id, userId: user.id } });
    if (!order) {
      return res.status(404).send({ message: "Order not found" });
    }
    if (order.status !== "delivered") {
      return res.status(400).send({ message: "Order is not delivered yet" });
    }

    await wallet.capture(user.id, order.id, parseFloat(order.total));
    await wallet.grantBonus(user.id, order.id, Math.floor(order.total / 10));

    order.status = "completed";
    order.completedAt = new Date();
    await order.save();
    await catalog.put(`/orders/${order.catalogOrderId}`, { status: "completed" });

    res.send(order);
  } catch (err) {
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

    await catalog.put(`/orders/${order.catalogOrderId}`, { status: "cancelled" });

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
    if (!rating) {
      res.status(400).send({ message: "Rating is required" });
    }
    if (rating > 5) {
      return res.status(400).send({ message: "Rating must be 5 or less" });
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
    const address = await db.address.findByPk(req.params.id);
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
    const address = await db.address.create({ ...req.body, userId: user.id });
    res.send(address);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.updateAddress = async (req, res) => {
  try {
    await db.address.update(req.body, { where: { id: req.params.id } });
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
    const item = await db.wishlist.create({ userId: user.id, productId: req.body.productId });
    res.send(item);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.deleteWishlist = async (req, res) => {
  try {
    await db.wishlist.destroy({ where: { id: req.params.id } });
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
