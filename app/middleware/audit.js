const db = require("../models");
const logger = require("../services/logger");

exports.record = async (req, action, entity, entityId, payload) => {
  try {
    const actor = req.user.username;
    await db.auditLog.create({ actor, action, entity, entityId: String(entityId), payload });
  } catch (err) {
    logger.error(`audit failed: ${err.message}`);
  }
};
