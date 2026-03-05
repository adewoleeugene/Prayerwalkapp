export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getAppBaseUrl(reqLike: { protocol: string; get(name: string): string | undefined }): string {
  const configured = (process.env.APP_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${reqLike.protocol}://${reqLike.get('host') || 'localhost:3000'}`;
}
