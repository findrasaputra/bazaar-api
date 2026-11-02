const multer = require("multer");

module.exports = multer({
  dest: "uploads/",
  limits: { fileSize: 1024 * 1024 * 1024 },
});
