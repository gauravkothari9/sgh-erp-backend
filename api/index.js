// Vercel serverless entrypoint. `server.js` exports the express app and
// only calls `app.listen` when not on Vercel.
require('dotenv').config();
const { connect } = require('../src/lib/db');
const app = require('../server');

// Open the Mongo connection once per cold start. Mongoose caches the
// connection; subsequent invocations on the same instance reuse it.
let ready;
function ensureReady() {
  if (!ready) ready = connect();
  return ready;
}

module.exports = async (req, res) => {
  try {
    await ensureReady();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database unavailable: ' + err.message });
    return;
  }
  return app(req, res);
};
