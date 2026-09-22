// Route real CLI HTTP requests to the loopback TLS fixture without changing TLS verification.
const axios = require('axios');
const adapter = axios.getAdapter('http');
axios.defaults.adapter = (config) =>
  adapter({ ...config, baseURL: undefined, url: process.env.DEPS_TEST_CA_URL, proxy: false });
