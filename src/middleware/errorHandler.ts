import type express from 'express';
import { isDomainError } from '../errors/domainError';
import { logger } from '../lib/logger';

export function errorHandler(
  err: unknown,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) {
  if (isDomainError(err)) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
    return;
  }

  logger.error('Unhandled request error', err, {
    method: req.method,
    path: req.path,
  });
  const message = err instanceof Error ? err.message : 'internal_server_error';
  res.status(500).json({ error: message });
}
