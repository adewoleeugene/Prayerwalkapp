const FINGERPRINT_KEY = 'pwaDeviceFingerprint';

function ensureFingerprint(): string {
  let fp = localStorage.getItem(FINGERPRINT_KEY);
  if (!fp) {
    fp = Math.random().toString(36).substring(7) + Date.now().toString(36);
    localStorage.setItem(FINGERPRINT_KEY, fp);
  }
  return fp;
}

type ApiResponse<T = unknown> = { data: T };

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string | number | undefined>
): Promise<ApiResponse<T>> {
  const fingerprint = ensureFingerprint();
  let url = `/api${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-device-fingerprint': fingerprint,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/pwa/login';
    throw new Error('Unauthorized');
  }

  const data = await res.json().catch(() => ({})) as T;
  if (!res.ok) {
    const msg = (data as Record<string, unknown>)?.error || `Request failed: ${res.status}`;
    throw Object.assign(new Error(String(msg)), { response: { status: res.status, data } });
  }

  return { data };
}

const pwaClient = {
  get: <T = unknown>(path: string, params?: Record<string, string | number | undefined>) =>
    request<T>('GET', path, undefined, params),
  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>('POST', path, body),
  delete: <T = unknown>(path: string, body?: unknown) =>
    request<T>('DELETE', path, body),
};

export const pwaApi = {
  locations: {
    list: (lat: number, lng: number, radius: number) =>
      pwaClient.get('/locations', { lat, lng, radius }),
    get: (id: string) =>
      pwaClient.get(`/locations/${id}`),
  },
  branches: {
    list: (lat?: number, lng?: number, radius?: number) =>
      pwaClient.get('/branches', { lat, lng, radius }),
  },
  walks: {
    start: (
      locationId: string | undefined,
      latitude: number,
      longitude: number,
      branch?: string,
      participants?: string[],
      startAddress?: string,
      meta?: { clientRequestId?: string; clientEventAt?: string; localSessionId?: string }
    ) =>
      pwaClient.post('/walks/start', {
        locationId, latitude, longitude, branch, participants, startAddress,
        deviceFingerprint: ensureFingerprint(),
        ...meta,
      }),
    history: (limit = 80, options?: { branch?: string; days?: number; allTime?: boolean; showAreaWalks?: boolean }) =>
      pwaClient.get('/walks/history', {
        limit,
        branch: options?.branch,
        ...(options?.allTime ? { allTime: 'true' } : { days: options?.days ?? 14 }),
        ...(options?.showAreaWalks ? { showAreaWalks: 'true' } : {}),
        walkType: 'all',
        includeActive: 1,
      }),
    track: (
      sessionId: string, latitude: number, longitude: number,
      speed?: number, accuracy?: number, isMock?: boolean,
      meta?: { clientRequestId?: string; clientEventAt?: string }
    ) =>
      pwaClient.post('/walks/track', { sessionId, latitude, longitude, speed, accuracy, isMock, ...meta }),
    arrive: (
      sessionId: string, locationId: string, latitude: number, longitude: number,
      meta?: { clientRequestId?: string; clientEventAt?: string }
    ) =>
      pwaClient.post('/walks/arrive', { sessionId, locationId, latitude, longitude, ...meta }),
    complete: (
      sessionId: string, locationId: string | undefined, latitude: number, longitude: number,
      prayerSummary?: string, prayerJournal?: string,
      meta?: { clientRequestId?: string; clientEventAt?: string; localSessionId?: string }
    ) =>
      pwaClient.post('/walks/complete', { sessionId, locationId, latitude, longitude, prayerSummary, prayerJournal, ...meta }),
    delete: (sessionId: string) =>
      pwaClient.delete('/walks', { sessionId }),
  },
};

export default pwaClient;
