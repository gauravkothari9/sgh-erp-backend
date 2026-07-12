const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// Socket.IO instance, set once the HTTP server is up. Notifications are pushed
// to a per-user room (`user:<id>`), so a client only ever receives its own.
let io = null;

/**
 * Attach the realtime layer to the running HTTP server.
 * Clients connect with their JWT: io(url, { auth: { token } }).
 */
const initRealtime = (server, allowedOrigin) => {
  io = new Server(server, {
    cors: {
      origin: (origin, cb) => cb(null, allowedOrigin(origin)),
      credentials: true,
    },
    // Long-poll fallback matters on shop-floor phones with flaky wifi.
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id || decoded._id || decoded.userId;
      if (!socket.userId) return next(new Error('Bad token'));
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);
    socket.on('disconnect', () => socket.leave(`user:${socket.userId}`));
  });

  console.log('🔌 Realtime (socket.io) ready');
  return io;
};

// Push a saved notification to its recipient, if they're online. Best-effort —
// the bell still polls, so an offline user picks it up on next load.
const pushNotification = (userId, notification) => {
  if (!io) return;
  io.to(`user:${String(userId)}`).emit('notification', notification);
};

module.exports = { initRealtime, pushNotification };
