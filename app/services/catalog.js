const axios = require("axios");

const catalog = axios.create({
  baseURL: process.env.CATALOG_URL,
  auth: {
    username: process.env.CATALOG_KEY,
    password: process.env.CATALOG_SECRET,
  },
});

module.exports = catalog;
