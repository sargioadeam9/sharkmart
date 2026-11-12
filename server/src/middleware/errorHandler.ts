/**
 * Global error handler.
 *
 * AGENTS.md §7.12: structured JSON with a code, and no stack traces, SQL or
 * internal paths in production responses. The full error goes to the log.
 */

import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env.js';
import { fail, type ApiFailure } from '../types/api.js';

/** An error a route throws on purpose, with a contract code. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiFailure['error']['code'];
  readonly details?: unknown;

  constructor(
    status: number,
    code: ApiFailure['error']['code'],
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) =>
  new HttpError(404, 'NOT_FOUND', `${what} not found`);

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(422).json(
      fail(
        'VALIDATION_ERROR',
        'Request validation failed',
        err.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      ),
    );
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json(fail(err.code, err.message, err.details));
    return;
  }

   
  console.error('[unhandled]', err);

  res.status(500).json(
    fail(
      'INTERNAL_ERROR',
      isProduction
        ? 'Something went wrong'
        : err instanceof Error
          ? err.message
          : 'Unknown error',
    ),
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(fail('NOT_FOUND', `No route for ${req.method} ${req.path}`));
}
