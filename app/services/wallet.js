const db = require("../models");

function withTransaction(transaction, fn) {
  return transaction ? fn(transaction) : db.sequelize.transaction(fn);
}

async function getWallet(userId, transaction) {
  await db.wallet.bulkCreate([{ userId }], { ignoreDuplicates: true, transaction });
  return db.wallet.findOne({ where: { userId }, transaction, lock: transaction.LOCK.UPDATE });
}

exports.getBalance = (userId, transaction) => withTransaction(transaction, async (t) => {
  const wallet = await getWallet(userId, t);
  return parseFloat(wallet.balance) - parseFloat(wallet.held);
});

exports.hold = (userId, orderId, amount, transaction) => withTransaction(transaction, async (t) => {
  const wallet = await getWallet(userId, t);
  wallet.held = parseFloat(wallet.held) + amount;
  await wallet.save({ transaction: t });
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "hold", amount }, { transaction: t });
});

exports.capture = (userId, orderId, amount, transaction) => withTransaction(transaction, async (t) => {
  const wallet = await getWallet(userId, t);
  wallet.balance = parseFloat(wallet.balance) - amount;
  wallet.held = parseFloat(wallet.held) - amount;
  await wallet.save({ transaction: t });
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "capture", amount }, { transaction: t });
});

exports.refund = (userId, orderId, amount, transaction) => withTransaction(transaction, async (t) => {
  const wallet = await getWallet(userId, t);
  wallet.held = parseFloat(wallet.held) - amount;
  await wallet.save({ transaction: t });
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "refund", amount }, { transaction: t });
});

exports.grantBonus = (userId, orderId, points, transaction) => withTransaction(transaction, async (t) => {
  const wallet = await getWallet(userId, t);
  const amount = points * parseFloat(process.env.BONUS_POINT_VALUE) / 100;
  wallet.balance = parseFloat(wallet.balance) + amount;
  await wallet.save({ transaction: t });
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "bonus", amount }, { transaction: t });
});
