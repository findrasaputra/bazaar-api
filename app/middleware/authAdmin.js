const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const config = require("../../config/auth.config");
const logger = require("../services/logger");

// Highest privilege first; an account's effective role is the first one it holds.
const ROLE_PRIORITY = ["admin", "merchant", "staff"];

let jwks = null;
let jwksIssuer = null;

function getJwksClient(issuer) {
  if (!jwks || jwksIssuer !== issuer) {
    jwks = jwksClient({
      jwksUri: `${issuer}/protocol/openid-connect/certs`,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    jwksIssuer = issuer;
  }
  return jwks;
}

if (!config.oidc()) {
  logger.error("OIDC_BASE_URL, OIDC_REALM or OIDC_CLIENT_ID is not set; Keycloak admin logins are disabled");
}
config.legacySecret();

function bearer(req) {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
  return match ? match[1] : null;
}

function unauthorized(res) {
  return res.status(401).send({ message: "Unauthorized" });
}

function verifyLegacy(token) {
  const secret = config.legacySecret();
  if (!secret) {
    return null;
  }
  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload.exp !== "number") {
      return null;
    }
    return {
      id: payload.id,
      username: payload.username,
      merchantId: payload.merchantId,
      // Legacy tokens issued before roles existed belong to store owners.
      roles: Array.isArray(payload.roles) ? payload.roles : ["merchant"],
    };
  } catch (err) {
    return null;
  }
}

async function verifyKeycloak(token, header) {
  const settings = config.oidc();
  if (!settings || !header.kid) {
    return null;
  }
  try {
    const key = await getJwksClient(settings.issuer).getSigningKey(header.kid);
    const payload = jwt.verify(token, key.getPublicKey(), {
      algorithms: ["RS256"],
      issuer: settings.issuer,
    });
    if (payload.azp !== settings.clientId) {
      return null;
    }
    return {
      id: payload.sub,
      username: payload.preferred_username,
      merchantId: payload.merchant_id,
      roles: (payload.realm_access && payload.realm_access.roles) || [],
    };
  } catch (err) {
    return null;
  }
}

function toStoreId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

exports.authAdmin = async (req, res, next) => {
  const token = bearer(req);
  const decoded = token && jwt.decode(token, { complete: true });
  if (!decoded || !decoded.header) {
    return unauthorized(res);
  }

  let identity = null;
  if (decoded.header.alg === "HS256") {
    identity = verifyLegacy(token);
  } else if (decoded.header.alg === "RS256") {
    identity = await verifyKeycloak(token, decoded.header);
  }
  if (!identity) {
    return unauthorized(res);
  }

  const role = ROLE_PRIORITY.find((name) => identity.roles.includes(name));
  if (!role) {
    return res.status(403).send({ message: "Your account has no admin role" });
  }
  const merchantId = toStoreId(identity.merchantId);
  if (role !== "admin" && !merchantId) {
    return res.status(400).send({ message: "Your account is not linked to a store" });
  }

  req.user = { id: identity.id, username: identity.username };
  req.admin = {
    username: identity.username,
    merchantId: role === "admin" ? null : merchantId,
    roles: identity.roles,
    role,
  };
  next();
};

// Only lets the listed roles through. Run it after authAdmin.
exports.allow = (...roles) => (req, res, next) => {
  if (!req.admin || !roles.includes(req.admin.role)) {
    return res.status(403).send({ message: "You are not allowed to do this" });
  }
  next();
};

exports.ROLE_PRIORITY = ROLE_PRIORITY;
