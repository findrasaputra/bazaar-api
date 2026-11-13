const crypto = require("crypto");

const digest = (value) => crypto.createHash("sha256").update(value).digest();

// Catalog (WooCommerce) webhooks carry X-WC-Webhook-Signature: the base64
// HMAC-SHA256 of the raw request body, keyed with the webhook secret.
module.exports = (req, res, next) => {
  const secret = process.env.CATALOG_WEBHOOK_SECRET;
  const given = req.headers["x-wc-webhook-signature"];
  if (!secret || typeof given !== "string" || !Buffer.isBuffer(req.rawBody)) {
    return res.status(401).send({ message: "Invalid signature" });
  }
  const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("base64");
  if (!crypto.timingSafeEqual(digest(given), digest(expected))) {
    return res.status(401).send({ message: "Invalid signature" });
  }
  next();
};
