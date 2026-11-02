const logger = require("../services/logger");

module.exports = (req, res, next) => {
  const send = res.send;
  res.send = function (body) {
    logger.info(JSON.stringify({
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      body: req.body,
      status: res.statusCode,
      response: body,
    }));
    return send.call(this, body);
  };
  next();
};
