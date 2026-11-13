// Local stand-in for the catalog platform and the auth service, for development only.
const crypto = require("crypto");
const express = require("express");

const app = express();
app.use(express.json());

const store = { products: {}, customers: {}, orders: {}, variations: {} };
let nextId = 1000;

function create(collection) {
  return (req, res) => {
    const id = nextId++;
    store[collection][id] = { id, ...req.body };
    res.status(201).send(store[collection][id]);
  };
}

function read(collection) {
  return (req, res) => {
    const item = store[collection][req.params.id];
    if (!item) return res.status(404).send({ code: "not_found", message: "Invalid ID." });
    res.send(item);
  };
}

function update(collection) {
  return (req, res) => {
    const item = store[collection][req.params.id];
    if (!item) return res.status(404).send({ code: "not_found", message: "Invalid ID." });
    Object.assign(item, req.body);
    res.send(item);
  };
}

app.post("/catalog/products", (req, res) => {
  const id = nextId++;
  store.products[id] = { id, price: req.body.regular_price, ...req.body };
  res.status(201).send(store.products[id]);
});
app.get("/catalog/products/:id", read("products"));
app.put("/catalog/products/:id", update("products"));
app.post("/catalog/products/:id/variations", create("variations"));
app.put("/catalog/products/:pid/variations/:id", update("variations"));
app.delete("/catalog/products/:pid/variations/:id", (req, res) => {
  delete store.variations[req.params.id];
  res.send({ deleted: true });
});
// Like WooCommerce, customer passwords are stored but never returned.
const withoutPassword = ({ password, ...customer }) => customer;
app.post("/catalog/customers", (req, res) => {
  const id = nextId++;
  store.customers[id] = { id, ...req.body };
  res.status(201).send(withoutPassword(store.customers[id]));
});
app.get("/catalog/customers/:id", (req, res) => {
  const customer = store.customers[req.params.id];
  if (!customer) return res.status(404).send({ code: "not_found", message: "Invalid ID." });
  res.send(withoutPassword(customer));
});
app.post("/catalog/orders", create("orders"));
app.put("/catalog/orders/:id", update("orders"));

// Auth service. Only tokens issued by /auth/login are active, so tokens cannot be
// hand-crafted. Tokens live in memory and are lost when the mock restarts.
// /auth/login has no password: it is a development stand-in for the real login.
const tokens = new Map();
const MOCK_CLIENT_ID = process.env.MOCK_CLIENT_ID || "bazaar-mobile";

app.post("/auth/login", (req, res) => {
  const { externalId } = req.body || {};
  if (typeof externalId !== "string" || !externalId) {
    return res.status(400).send({ message: "externalId is required" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, { sub: externalId, client_id: MOCK_CLIENT_ID });
  res.send({ access_token: token, token_type: "Bearer" });
});

app.post("/auth/introspect", (req, res) => {
  const session = tokens.get(req.body && req.body.token);
  res.send(session ? { active: true, ...session } : { active: false });
});

const port = Number(process.env.MOCK_PORT) || 9000;
app.listen(port, () => console.log(`mock upstream listening on ${port}`));
