const logger = require("../app/services/logger");

const ROLES = ["admin", "merchant", "staff"];
const MIN_SECRET_LENGTH = 32;
const KNOWN_WEAK_SECRETS = ["changeme", "bazaar-super-secret-key", "secret"];

let warned = false;

// The legacy HS256 secret, or null when it is missing or weak. A weak secret
// disables legacy admin tokens; Keycloak logins keep working.
function legacySecret() {
  const secret = process.env.JWT_SECRET || "";
  const weak = secret.length < MIN_SECRET_LENGTH || KNOWN_WEAK_SECRETS.includes(secret.toLowerCase());
  if (weak) {
    if (!warned) {
      logger.error(`JWT_SECRET is missing or weak (needs ${MIN_SECRET_LENGTH}+ characters); legacy admin tokens are disabled`);
      warned = true;
    }
    return null;
  }
  return secret;
}

// Keycloak settings, or null when any of them is missing.
function oidc() {
  const baseUrl = process.env.OIDC_BASE_URL;
  const realm = process.env.OIDC_REALM;
  const clientId = process.env.OIDC_CLIENT_ID;
  if (!baseUrl || !realm || !clientId) {
    return null;
  }
  return { issuer: `${baseUrl.replace(/\/+$/, "")}/realms/${realm}`, clientId };
}

module.exports = { ROLES, legacySecret, oidc };
