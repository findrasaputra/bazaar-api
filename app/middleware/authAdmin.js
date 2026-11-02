const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const config = require("../../config/auth.config");

const clients = {};

function getClient(issuer) {
  if (!clients[issuer]) {
    clients[issuer] = jwksClient({
      jwksUri: `${issuer}/protocol/openid-connect/certs`,
      cache: true,
      rateLimit: false,
    });
  }
  return clients[issuer];
}

function verifyLegacy(token, req, res, next) {
  jwt.verify(token, config.secret, (err, payload) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    req.user = { id: payload.id, username: payload.username };
    req.admin = {
      username: payload.username,
      merchantId: payload.merchantId,
      roles: payload.roles || [],
    };
    next();
  });
}

exports.authAdmin = (req, res, next) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  if (decoded.header.alg === "HS256") {
    return verifyLegacy(token, req, res, next);
  }

  const issuer = decoded.payload.iss || "";
  if (!issuer.startsWith(`${process.env.OIDC_BASE_URL}/realms/`)) {
    return res.status(401).send({ message: "Unknown issuer" });
  }

  getClient(issuer).getSigningKey(decoded.header.kid, (err, key) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    jwt.verify(token, key.getPublicKey(), { algorithms: ["RS256"] }, (err, payload) => {
      if (err) {
        return res.status(401).send({ message: "Unauthorized" });
      }
      req.admin = {
        username: payload.preferred_username,
        merchantId: payload.merchant_id,
        roles: (payload.realm_access && payload.realm_access.roles) || [],
      };
      next();
    });
  });
};
