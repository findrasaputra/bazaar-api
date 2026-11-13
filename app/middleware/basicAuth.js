const crypto = require("crypto");

const digest = (value) => crypto.createHash("sha256").update(value).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

module.exports = (req, res, next) => {
  const expectedUser = process.env.PARTNER_USER;
  const expectedPass = process.env.PARTNER_PASS;
  const match = /^Basic (\S+)$/.exec(req.headers.authorization || "");
  if (!expectedUser || !expectedPass || !match) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const decoded = Buffer.from(match[1], "base64").toString();
  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);

  // Compare both parts every time, so timing does not reveal which one was wrong.
  const userOk = safeEqual(user, expectedUser);
  const passOk = safeEqual(pass, expectedPass);
  if (userOk && passOk) {
    return next();
  }
  return res.status(401).send({ message: "Unauthorized" });
};
