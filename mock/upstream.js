// Local stand-in for the catalog platform and the auth service, for development only.
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
app.post("/catalog/customers", create("customers"));
app.get("/catalog/customers/:id", read("customers"));
app.post("/catalog/orders", create("orders"));
app.put("/catalog/orders/:id", update("orders"));

app.post("/auth/introspect", (req, res) => {
  res.send({ active: Boolean(req.body.token) });
});

app.listen(9000, () => console.log("mock upstream listening on 9000"));
