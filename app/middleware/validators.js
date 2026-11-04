const ROLES = ["admin", "merchant", "staff"];
const ORDER_STATUSES = ["pending", "paid", "processing", "shipped", "delivered", "completed", "cancel_requested", "cancelled"];

exports.checkRolesExisted = (req, res, next) => {
  if (req.body.roles) {
    for (let i = 0; i < req.body.roles.length; i++) {
      if (!ROLES.includes(req.body.roles[i])) {
        return res.status(400).send({ message: `Role ${req.body.roles[i]} does not exist` });
      }
    }
  }
  next();
};

exports.checkStatusValid = (req, res, next) => {
  for (let i = 0; i < ORDER_STATUSES.length; i++) {
    if (ORDER_STATUSES[i] === req.body.status) {
      return next();
    }
  }
  return res.status(400).send({ message: "Invalid status" });
};
