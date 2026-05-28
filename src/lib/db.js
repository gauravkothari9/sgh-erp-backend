// Mongoose connection singleton. Connect once at boot, reuse everywhere.
const mongoose = require('mongoose');

let connectPromise = null;

function connect() {
  if (connectPromise) return connectPromise;
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sgh_erp';
  mongoose.set('strictQuery', true);
  connectPromise = mongoose
    .connect(uri, { serverSelectionTimeoutMS: 10_000 })
    .then(() => {
      console.log(`✓ MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
      return mongoose.connection;
    })
    .catch((err) => {
      connectPromise = null;
      throw err;
    });
  return connectPromise;
}

module.exports = { connect, mongoose };
