const axios = require("axios");
const jwt = require("jsonwebtoken");

function bearer(req) {
  return (req.headers.authorization || "").replace("Bearer ", "");
}

exports.verifyToken = async (req, res, next) => {
  const token = bearer(req);
  if (!token) {
    return res.status(401).send({ message: "No token provided" });
  }
  try {
    const { data } = await axios.post(`${process.env.AUTH_SERVICE_URL}/introspect`, { token });
    if (!data.active) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    next();
  } catch (err) {
    return res.status(401).send({ message: "Unauthorized" });
  }
};

exports.getUserId = (req) => {
  const decoded = jwt.decode(bearer(req));
  return decoded ? decoded.sub : null;
};
