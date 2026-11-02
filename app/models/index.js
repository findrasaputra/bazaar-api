const { Sequelize, DataTypes } = require("sequelize");
const dbConfig = require("../../config/db.config");

const sequelize = new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
  host: dbConfig.HOST,
  port: dbConfig.PORT,
  dialect: "postgres",
  logging: (sql) => console.log(sql),
  logQueryParameters: true,
  pool: dbConfig.pool,
});

const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.merchant = sequelize.define("merchant", {
  name: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, unique: true },
  commissionRate: { type: DataTypes.DECIMAL(5, 4), defaultValue: 0.1 },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: "merchants" });

db.adminUser = sequelize.define("adminUser", {
  username: { type: DataTypes.STRING, unique: true },
  email: DataTypes.STRING,
  role: { type: DataTypes.STRING, defaultValue: "merchant" },
  merchantId: DataTypes.INTEGER,
}, { tableName: "admin_users" });

db.appUser = sequelize.define("appUser", {
  externalId: { type: DataTypes.STRING, unique: true },
  email: DataTypes.STRING,
  name: DataTypes.STRING,
  phone: DataTypes.STRING,
  catalogCustomerId: DataTypes.INTEGER,
}, { tableName: "app_users" });

db.product = sequelize.define("product", {
  merchantId: DataTypes.INTEGER,
  catalogProductId: DataTypes.INTEGER,
  name: DataTypes.STRING,
  description: DataTypes.TEXT,
  price: DataTypes.DECIMAL(12, 2),
  stock: { type: DataTypes.INTEGER, defaultValue: 0 },
  ratingAvg: { type: DataTypes.FLOAT, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: "products" });

db.variation = sequelize.define("variation", {
  productId: DataTypes.INTEGER,
  catalogVariationId: DataTypes.INTEGER,
  name: DataTypes.STRING,
  price: DataTypes.DECIMAL(12, 2),
  stock: { type: DataTypes.INTEGER, defaultValue: 0 },
}, { tableName: "variations" });

db.cartItem = sequelize.define("cartItem", {
  userId: DataTypes.INTEGER,
  productId: DataTypes.INTEGER,
  variationId: DataTypes.INTEGER,
  quantity: DataTypes.INTEGER,
  price: DataTypes.DECIMAL(12, 2),
}, { tableName: "cart_items" });

db.order = sequelize.define("order", {
  userId: DataTypes.INTEGER,
  merchantId: DataTypes.INTEGER,
  catalogOrderId: DataTypes.INTEGER,
  status: { type: DataTypes.STRING, defaultValue: "pending" },
  subtotal: DataTypes.DECIMAL(12, 2),
  shippingFee: DataTypes.DECIMAL(12, 2),
  total: DataTypes.DECIMAL(12, 2),
  staffCode: DataTypes.STRING,
  cancelReason: DataTypes.STRING,
  paidAt: DataTypes.DATE,
  deliveredAt: DataTypes.DATE,
  completedAt: DataTypes.DATE,
}, { tableName: "orders" });

db.orderItem = sequelize.define("orderItem", {
  orderId: DataTypes.INTEGER,
  productId: DataTypes.INTEGER,
  variationId: DataTypes.INTEGER,
  quantity: DataTypes.INTEGER,
  price: DataTypes.DECIMAL(12, 2),
}, { tableName: "order_items" });

db.wallet = sequelize.define("wallet", {
  userId: { type: DataTypes.INTEGER, unique: true },
  balance: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  held: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
}, { tableName: "wallets" });

db.walletTx = sequelize.define("walletTx", {
  walletId: DataTypes.INTEGER,
  orderId: DataTypes.INTEGER,
  type: DataTypes.STRING,
  amount: DataTypes.DECIMAL(12, 2),
}, { tableName: "wallet_transactions" });

db.address = sequelize.define("address", {
  userId: DataTypes.INTEGER,
  label: DataTypes.STRING,
  recipient: DataTypes.STRING,
  phone: DataTypes.STRING,
  line1: DataTypes.STRING,
  city: DataTypes.STRING,
  postcode: DataTypes.STRING,
}, { tableName: "addresses" });

db.wishlist = sequelize.define("wishlist", {
  userId: DataTypes.INTEGER,
  productId: DataTypes.INTEGER,
}, { tableName: "wishlists" });

db.review = sequelize.define("review", {
  productId: DataTypes.INTEGER,
  userId: DataTypes.INTEGER,
  orderId: DataTypes.INTEGER,
  authorName: DataTypes.STRING,
  rating: DataTypes.INTEGER,
  comment: DataTypes.TEXT,
}, { tableName: "reviews" });

db.staff = sequelize.define("staff", {
  code: { type: DataTypes.STRING, unique: true },
  name: DataTypes.STRING,
}, { tableName: "staff" });

db.payout = sequelize.define("payout", {
  merchantId: DataTypes.INTEGER,
  periodStart: DataTypes.DATE,
  periodEnd: DataTypes.DATE,
  amount: DataTypes.DECIMAL(12, 2),
}, { tableName: "payouts" });

db.appLog = sequelize.define("appLog", {
  userId: DataTypes.STRING,
  event: DataTypes.STRING,
  ip: DataTypes.STRING,
  latitude: DataTypes.FLOAT,
  longitude: DataTypes.FLOAT,
  userAgent: DataTypes.STRING,
}, { tableName: "app_logs" });

db.auditLog = sequelize.define("auditLog", {
  actor: DataTypes.STRING,
  action: DataTypes.STRING,
  entity: DataTypes.STRING,
  entityId: DataTypes.STRING,
  payload: DataTypes.JSONB,
}, { tableName: "audit_logs" });

db.jobLock = sequelize.define("jobLock", {
  name: DataTypes.STRING,
  lockedAt: DataTypes.DATE,
}, { tableName: "job_locks" });

db.recoMapping = sequelize.define("recoMapping", {
  concernTag: DataTypes.STRING,
  productId: DataTypes.INTEGER,
}, { tableName: "reco_mappings" });

db.analyticsEvent = sequelize.define("analyticsEvent", {
  userId: DataTypes.INTEGER,
  type: DataTypes.STRING,
  payload: DataTypes.JSONB,
}, { tableName: "analytics_events" });

db.product.hasMany(db.variation, { foreignKey: "productId" });
db.variation.belongsTo(db.product, { foreignKey: "productId" });
db.order.hasMany(db.orderItem, { foreignKey: "orderId" });
db.orderItem.belongsTo(db.order, { foreignKey: "orderId" });
db.product.hasMany(db.review, { foreignKey: "productId" });

module.exports = db;
