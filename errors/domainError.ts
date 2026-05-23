export class DomainError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(message: string, options?: { statusCode?: number; code?: string; details?: unknown }) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = options?.statusCode ?? 400;
    this.code = options?.code ?? 'domain_error';
    this.details = options?.details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
