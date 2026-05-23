export function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function getAppBaseUrl(request: { headers: { get(name: string): string | null } }): string {
  const configured = (process.env.APP_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  const host = request.headers.get('host') || 'localhost:3000';
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}
