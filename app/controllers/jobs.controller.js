const moment = require("moment");
const db = require("../models");
const wallet = require("../services/wallet");

const Op = db.Sequelize.Op;

exports.completeOrders = async (req, res) => {
  try {
    const cutoff = moment().subtract(process.env.ORDER_COMPLETE_DAYS, "days").toDate();
    const orders = await db.order.findAll({
      where: { status: "delivered", deliveredAt: { [Op.lte]: cutoff } },
    });

    let completed = 0;
    for (const { id } of orders) {
      await db.sequelize.transaction(async (t) => {
        const order = await db.order.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (order.status !== "delivered") {
          return;
        }
        await wallet.capture(order.userId, order.id, parseFloat(order.total), t);
        await wallet.grantBonus(order.userId, order.id, Math.floor(order.total / 10), t);
        order.status = "completed";
        order.completedAt = new Date();
        await order.save({ transaction: t });
        completed++;
      });
    }
    res.send({ completed });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.closing14Days = async (req, res) => {
  try {
    const end = moment().startOf("day");
    const start = end.clone().subtract(14, "days");
    const merchants = await db.merchant.findAll({ where: { isActive: true } });

    for (const merchant of merchants) {
      const total = await db.order.sum("total", {
        where: {
          merchantId: merchant.id,
          status: "completed",
          completedAt: { [Op.between]: [start.toDate(), end.toDate()] },
        },
      });
      const amount = (total || 0) * (1 - parseFloat(merchant.commissionRate));
      await db.payout.create({
        merchantId: merchant.id,
        periodStart: start.toDate(),
        periodEnd: end.toDate(),
        amount,
      });
    }
    res.send({ merchants: merchants.length });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};

exports.exportAnalytics = async (req, res) => {
  try {
    try {
      await db.jobLock.create({ name: "analytics-export", lockedAt: new Date() });
    } catch (err) {
      if (err instanceof db.Sequelize.UniqueConstraintError) {
        return res.status(409).send({ message: "Export already running" });
      }
      throw err;
    }

    const [rows] = await db.sequelize.query("SELECT * FROM analytics_events");
    const summary = {};
    for (const row of rows) {
      summary[row.type] = (summary[row.type] || 0) + 1;
    }

    await db.jobLock.destroy({ where: { name: "analytics-export" } });
    res.send({ total: rows.length, summary });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
};
