export type ApiSuccess<T> = {
  success: true;
} & T;

export type ApiFailure = {
  success?: false;
  error: string;
  code?: string;
  details?: unknown;
};
