/**
 * Centralized error handling middleware for SGH ERP
 * Consistent error response format across all API endpoints
 */

// 404 handler — route not found
const notFound = (req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

// Global error handler
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal Server Error';
  let errors = null;

  // ─── Zod validation errors (v2 modules) ──────────────────────────────────
  if (err.name === 'ZodError' && Array.isArray(err.issues)) {
    statusCode = 400;
    errors = err.issues.map((i) => ({
      field: i.path?.join('.') || '',
      message: i.message,
    }));
    const summary = errors.map((e) => `${e.field}: ${e.message}`).join(' · ');
    message = `Validation failed — ${summary}`;
  }

  // ─── Prisma known request errors ─────────────────────────────────────────
  // P2002 = unique constraint, P2003 = FK constraint, P2025 = record not found,
  // P2000 = value too long. See: https://www.prisma.io/docs/reference/api-reference/error-reference
  if (err.code && typeof err.code === 'string' && err.code.startsWith('P')) {
    if (err.code === 'P2002') {
      statusCode = 409;
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : err.meta?.target;
      message = target
        ? `Duplicate value on ${target}. That record already exists.`
        : 'Duplicate value — record already exists.';
    } else if (err.code === 'P2025') {
      statusCode = 404;
      message = err.meta?.cause || 'Record not found';
    } else if (err.code === 'P2003') {
      statusCode = 400;
      message = 'Cannot complete the operation: a referenced record does not exist or is still in use.';
    } else if (err.code === 'P2000') {
      statusCode = 400;
      message = `Value too long for the target column${err.meta?.column_name ? ` (${err.meta.column_name})` : ''}.`;
    }
  }

  // ─── Prisma client validation (bad query shape) ──────────────────────────
  if (err.name === 'PrismaClientValidationError') {
    statusCode = 400;
    message = 'Request did not match the expected shape. Check field names and types.';
  }

  // ─── JWT errors ──────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token. Please log in again.';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired. Please log in again.';
  }

  // ─── Express body-parser ─────────────────────────────────────────────────
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Invalid JSON in request body';
  }

  // Log in development
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

// Helper: Create an AppError with statusCode
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { notFound, errorHandler, AppError };
