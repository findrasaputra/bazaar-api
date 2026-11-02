const db = require("../models");

async function getWallet(userId) {
  let wallet = await db.wallet.findOne({ where: { userId } });
  if (!wallet) {
    wallet = await db.wallet.create({ userId, balance: 0, held: 0 });
  }
  return wallet;
}

exports.getBalance = async (userId) => {
  const wallet = await getWallet(userId);
  return parseFloat(wallet.balance) - parseFloat(wallet.held);
};

exports.hold = async (userId, orderId, amount) => {
  const wallet = await getWallet(userId);
  wallet.held = parseFloat(wallet.held) + amount;
  await wallet.save();
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "hold", amount });
};

exports.capture = async (userId, orderId, amount) => {
  const wallet = await getWallet(userId);
  wallet.balance = parseFloat(wallet.balance) - amount;
  wallet.held = parseFloat(wallet.held) - amount;
  await wallet.save();
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "capture", amount });
};

exports.refund = async (userId, orderId, amount) => {
  const wallet = await getWallet(userId);
  wallet.held = parseFloat(wallet.held) - amount;
  await wallet.save();
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "refund", amount });
};

exports.grantBonus = async (userId, orderId, points) => {
  const wallet = await getWallet(userId);
  const amount = points * parseFloat(process.env.BONUS_POINT_VALUE) / 100;
  wallet.balance = parseFloat(wallet.balance) + amount;
  await wallet.save();
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "bonus", amount });
};
