const crypto = require("crypto");

const digest = (value) => crypto.createHash("sha256").update(value).digest();

module.exports = (req, res, next) => {
  const expected = process.env.JOB_TOKEN;
  const given = req.headers["x-job-token"];
  if (!expected || typeof given !== "string" || !crypto.timingSafeEqual(digest(given), digest(expected))) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  next();
};
