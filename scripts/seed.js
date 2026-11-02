require("dotenv").config();
const db = require("../app/models");
const catalog = require("../app/services/catalog");

(async () => {
  await db.sequelize.sync({ alter: true });

  const merchant = await db.merchant.create({ name: "Demo Goods", slug: "demo-goods", commissionRate: 0.1 });
  await db.merchant.create({ name: "Other Shop", slug: "other-shop", commissionRate: 0.15 });

  const products = [
    { name: "Canvas Tote", price: 25, stock: 100 },
    { name: "Ceramic Mug", price: 12, stock: 200 },
    { name: "Desk Lamp", price: 48, stock: 30 },
  ];
  for (const p of products) {
    const { data } = await catalog.post("/products", { name: p.name, regular_price: String(p.price), stock_quantity: p.stock });
    await db.product.create({ ...p, merchantId: merchant.id, catalogProductId: data.id });
  }

  const alice = await db.appUser.create({ externalId: "user-alice", email: "alice@example.com", name: "Alice", phone: "+10000000001" });
  const bob = await db.appUser.create({ externalId: "user-bob", email: "bob@example.com", name: "Bob", phone: "+10000000002" });
  await db.wallet.create({ userId: alice.id, balance: 100 });
  await db.wallet.create({ userId: bob.id, balance: 100 });
  await db.address.create({ userId: alice.id, label: "Home", recipient: "Alice", phone: "+10000000001", line1: "1 Example St", city: "Springfield", postcode: "00001" });

  await db.staff.create({ code: "STAFF-7731", name: "Store Staff" });

  console.log("Seed complete");
  process.exit(0);
})();
