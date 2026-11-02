module.exports = (req, res, next) => {
  const header = req.headers.authorization || "";
  const [user, pass] = Buffer.from(header.replace("Basic ", ""), "base64")
    .toString()
    .split(":");

  if (user === process.env.PARTNER_USER && pass === process.env.PARTNER_PASS) {
    return next();
  }
  return res.status(401).send({ message: "Unauthorized" });
};
