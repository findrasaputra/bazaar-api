// Prints a legacy (HS256) admin token for local development.
// Usage: node scripts/admin-token.js <username> <role> [merchantId] [lifetime]
//   node scripts/admin-token.js owner merchant 1
//   node scripts/admin-token.js ops admin
require("dotenv").config();
const jwt = require("jsonwebtoken");
const config = require("../config/auth.config");

const [username, role, merchantId, lifetime = "1h"] = process.argv.slice(2);
if (!username || !config.ROLES.includes(role)) {
  console.error(`Usage: node scripts/admin-token.js <username> <${config.ROLES.join("|")}> [merchantId] [lifetime]`);
  process.exit(1);
}
const secret = config.legacySecret();
if (!secret) {
  console.error("Set JWT_SECRET in .env to 32+ random characters first (openssl rand -hex 32)");
  process.exit(1);
}

const payload = { id: username, username, roles: [role] };
if (merchantId) {
  payload.merchantId = Number(merchantId);
}
console.log(jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: lifetime }));
