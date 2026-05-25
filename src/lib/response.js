// Tiny envelope helpers so every v2 endpoint returns the same shape.
const ok = (res, data, message = 'OK') =>
  res.status(200).json({ success: true, message, data });

const created = (res, data, message = 'Created') =>
  res.status(201).json({ success: true, message, data });

const fail = (res, status, message, errors) =>
  res.status(status).json({ success: false, message, errors });

module.exports = { ok, created, fail };
