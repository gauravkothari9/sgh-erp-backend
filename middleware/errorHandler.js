// Centralized error handling. Consistent error response format across all
// API endpoints.

const notFound = (req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

const errorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal Server Error';
  let errors = null;

  // ─── Zod validation errors ─────────────────────────────────────────────
  if (err.name === 'ZodError' && Array.isArray(err.issues)) {
    statusCode = 400;
    errors = err.issues.map((i) => ({
      field: i.path?.join('.') || '',
      message: i.message,
    }));
    const summary = errors.map((e) => `${e.field}: ${e.message}`).join(' · ');
    message = `Validation failed — ${summary}`;
  }

  // ─── Mongoose / MongoDB errors ─────────────────────────────────────────
  if (err.name === 'ValidationError' && err.errors) {
    statusCode = 400;
    errors = Object.entries(err.errors).map(([field, e]) => ({ field, message: e.message }));
    message = `Validation failed — ${errors.map((e) => `${e.field}: ${e.message}`).join(' · ')}`;
  }
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for ${err.path}`;
  }
  if (err.code === 11000) {
    statusCode = 409;
    const dupField = err.keyValue ? Object.keys(err.keyValue).join(', ') : 'value';
    message = `Duplicate value on ${dupField}. That record already exists.`;
  }

  // ─── JWT errors ────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token. Please log in again.';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired. Please log in again.';
  }

  // ─── Express body-parser ───────────────────────────────────────────────
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Invalid JSON in request body';
  }

  if (process.env.NODE_ENV === 'development') {
    console.error('Error:', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
    });
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { notFound, errorHandler, AppError };
