const db = require("../models");
const config = require("../../config/business.config");

function withTransaction(transaction, fn) {
  return transaction ? fn(transaction) : db.sequelize.transaction(fn);
}

async function getWallet(userId, transaction) {
  await db.wallet.bulkCreate([{ userId }], { ignoreDuplicates: true, transaction });
  return db.wallet.findOne({ where: { userId }, transaction, lock: transaction.LOCK.UPDATE });
}

const toCents = (value) => Math.round(parseFloat(value) * 100);

function assertAmount(amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid wallet amount: ${amount}`);
  }
}

exports.getBalance = (userId, transaction) => withTransaction(transaction, async (t) => {
  const wallet = await getWallet(userId, t);
  return parseFloat(wallet.balance) - parseFloat(wallet.held);
});

exports.hold = (userId, orderId, amount, transaction) => withTransaction(transaction, async (t) => {
  assertAmount(amount);
  const wallet = await getWallet(userId, t);
  if (toCents(wallet.balance) - toCents(wallet.held) < toCents(amount)) {
    throw new Error("Insufficient balance");
  }
  wallet.held = parseFloat(wallet.held) + amount;
  await wallet.save({ transaction: t });
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "hold", amount }, { transaction: t });
});

exports.capture = (userId, orderId, amount, transaction) => withTransaction(transaction, async (t) => {
  assertAmount(amount);
  const wallet = await getWallet(userId, t);
  if (toCents(wallet.held) < toCents(amount)) {
    throw new Error("Capture exceeds held amount");
  }
  wallet.balance = parseFloat(wallet.balance) - amount;
  wallet.held = parseFloat(wallet.held) - amount;
  await wallet.save({ transaction: t });
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "capture", amount }, { transaction: t });
});

exports.refund = (userId, orderId, amount, transaction) => withTransaction(transaction, async (t) => {
  assertAmount(amount);
  const wallet = await getWallet(userId, t);
  if (toCents(wallet.held) < toCents(amount)) {
    throw new Error("Refund exceeds held amount");
  }
  wallet.held = parseFloat(wallet.held) - amount;
  await wallet.save({ transaction: t });
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "refund", amount }, { transaction: t });
});

exports.grantBonus = (userId, orderId, points, transaction) => withTransaction(transaction, async (t) => {
  if (!Number.isInteger(points) || points < 0) {
    throw new Error(`Invalid bonus points: ${points}`);
  }
  if (points === 0) {
    return;
  }
  const amount = points * config.bonusPointValue() / 100;
  const wallet = await getWallet(userId, t);
  wallet.balance = parseFloat(wallet.balance) + amount;
  await wallet.save({ transaction: t });
  await db.walletTx.create({ walletId: wallet.id, orderId, type: "bonus", amount }, { transaction: t });
});
