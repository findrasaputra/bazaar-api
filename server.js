require("dotenv").config();

const express = require("express");
const cors = require("cors");
const db = require("./app/models");
const logger = require("./app/services/logger");
const requestLogger = require("./app/middleware/requestLogger");

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.get("/", (req, res) => res.send({ name: "bazaar-api", status: "ok" }));

app.use("/api/app", require("./app/routes/app.routes"));
app.use("/api/admin", require("./app/routes/admin.routes"));
app.use("/api/webhooks/catalog", require("./app/routes/webhook.routes"));
app.use("/api/jobs", require("./app/routes/jobs.routes"));
app.use("/api/partner", require("./app/routes/partner.routes"));

db.sequelize.sync({ alter: true }).then(() => {
  logger.info("Database synced");
});

process.on("uncaughtException", (err) => {
  logger.error(err.message);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
