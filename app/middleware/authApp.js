const axios = require("axios");
const db = require("../models");
const logger = require("../services/logger");

const AUTH_TIMEOUT_MS = 5000;

function createAuthClient() {
  const options = { baseURL: process.env.AUTH_SERVICE_URL, timeout: AUTH_TIMEOUT_MS };
  if (process.env.AUTH_CLIENT_ID && process.env.AUTH_CLIENT_SECRET) {
    options.auth = { username: process.env.AUTH_CLIENT_ID, password: process.env.AUTH_CLIENT_SECRET };
  } else {
    logger.warn("AUTH_CLIENT_ID / AUTH_CLIENT_SECRET not set; token introspection is sent without API credentials");
  }
  if (process.env.NODE_ENV === "production" && /^http:\/\//i.test(process.env.AUTH_SERVICE_URL || "")) {
    logger.warn("AUTH_SERVICE_URL uses plain http in production; tokens are sent unencrypted");
  }
  return axios.create(options);
}

function allowedClientIds() {
  const ids = (process.env.AUTH_ALLOWED_CLIENT_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!ids.length) {
    logger.warn("AUTH_ALLOWED_CLIENT_IDS not set; tokens from any client are accepted");
    return null;
  }
  return ids;
}

const authClient = createAuthClient();
const allowedClients = allowedClientIds();

function bearer(req) {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
  return match ? match[1] : null;
}

// Resolves the caller from the auth service. Sends the error response itself and
// returns false when the caller cannot be identified.
async function authenticate(token, req, res) {
  let data;
  try {
    ({ data } = await authClient.post("/introspect", { token }));
  } catch (err) {
    logger.error(`auth service unavailable: ${err.message}`);
    res.status(503).send({ message: "Authentication service unavailable, please retry" });
    return false;
  }

  // The identity comes from the auth service's answer, never from the token itself.
  if (!data || data.active !== true || typeof data.sub !== "string" || !data.sub) {
    res.status(401).send({ message: "Unauthorized" });
    return false;
  }
  if (allowedClients && !allowedClients.includes(data.client_id)) {
    res.status(401).send({ message: "Unauthorized" });
    return false;
  }

  const user = await db.appUser.findOne({ where: { externalId: data.sub } });
  if (!user) {
    res.status(403).send({ message: "No customer account for this login" });
    return false;
  }
  req.externalId = data.sub;
  req.appUser = user;
  return true;
}

exports.verifyToken = async (req, res, next) => {
  const token = bearer(req);
  if (!token) {
    return res.status(401).send({ message: "No token provided" });
  }
  try {
    if (await authenticate(token, req, res)) {
      next();
    }
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

// Anonymous callers pass through; a caller who sends a token must send a valid one.
exports.optionalToken = async (req, res, next) => {
  if (!req.headers.authorization) {
    return next();
  }
  return exports.verifyToken(req, res, next);
};

exports.getUserId = (req) => req.externalId || null;
