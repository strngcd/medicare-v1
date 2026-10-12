/**
 * Validates request parts with zod schemas and exposes the parsed values on
 * `req.valid` (Express 5 makes req.query read-only, so we never mutate it).
 *
 *   router.post('/', validate({ body: createSchema }), controller.create)
 */
function validate(schemas) {
  return (req, res, next) => {
    req.valid = req.valid || {};
    for (const part of ['params', 'query', 'body']) {
      if (schemas[part]) {
        req.valid[part] = schemas[part].parse(req[part] ?? {});
      }
    }
    next();
  };
}

module.exports = validate;
