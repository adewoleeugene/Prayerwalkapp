const dbUrl = process.env.TEST_DATABASE_URL || '';

if (!dbUrl) {
  // Keep compatibility with existing environments but provide explicit guidance.
  // The helper layer will throw if no usable DB URL is available.
  // eslint-disable-next-line no-console
  console.warn('[tests] TEST_DATABASE_URL not set; falling back to DATABASE_URL if present.');
}
