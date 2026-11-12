/**
 * Zod validation middleware — security.md §7.
 *
 * Validates `query`, `params` and `body` against a schema and replaces the
 * request property with the parsed result, so handlers read typed, coerced
 * values and never re-parse a string.
 *
 * Every schema in `validators/` uses `.strict()`, so an unknown query key is a
 * 422 rather than a silently ignored typo. That is the point: `?catgory=fashion`
 * should fail loudly, not return the whole catalog.
 *
 * Express 4 does not forward a rejected promise from async middleware to the
 * error handler, so the wrapper catches and calls `next(err)` itself.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';

export interface ValidationSchemas {
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  body?: ZodTypeAny;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return function validator(req: Request, _res: Response, next: NextFunction): void {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      // The global error handler turns ZodError into the 422 envelope.
      next(error);
    }
  };
}
