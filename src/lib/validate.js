// Zod request validator middleware. Pass shape: { body?, query?, params? }.
const { ZodError } = require('zod');
const { fail } = require('./response');

const validate = (schemas) => (req, res, next) => {
  try {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.query) req.query = schemas.query.parse(req.query);
    if (schemas.params) req.params = schemas.params.parse(req.params);
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      return fail(res, 400, 'Validation failed', err.flatten());
    }
    next(err);
  }
};

module.exports = { validate };
