function number(name) {
  const value = parseFloat(process.env[name]);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

module.exports = {
  shippingFee: () => number("SHIPPING_FEE"),
  bonusPointValue: () => number("BONUS_POINT_VALUE"),
  orderCompleteDays: () => number("ORDER_COMPLETE_DAYS"),
};
