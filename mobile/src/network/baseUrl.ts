import { NativeModules } from 'react-native';

const DEFAULT_API_PORT = '3001';
const PROD_API_BASE_URL = 'https://prayerwalkapp.vercel.app';

function isTunnelHost(hostname: string): boolean {
  return hostname.endsWith('.exp.direct') || hostname.includes('exp.host') || hostname.endsWith('.expo.dev');
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function isLocalOrPrivateHost(hostname: string): boolean {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1') return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(lower)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(lower)) return true;
  return false;
}

function shouldUseEnvUrlInRelease(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (isLocalOrPrivateHost(parsed.hostname)) return false;
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveApiBaseUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (envUrl) {
    const normalized = normalizeBaseUrl(envUrl);
    if (__DEV__ || shouldUseEnvUrlInRelease(normalized)) {
      return normalized;
    }
  }

  // Release builds cannot call 127.0.0.1 on physical devices.
  if (!__DEV__) {
    return PROD_API_BASE_URL;
  }

  const scriptURL = (NativeModules as any)?.SourceCode?.scriptURL;
  if (scriptURL) {
    try {
      const metroHost = new URL(scriptURL).hostname;
      if (metroHost && metroHost !== 'localhost' && metroHost !== '127.0.0.1' && !isTunnelHost(metroHost)) {
        return `http://${metroHost}:${DEFAULT_API_PORT}`;
      }
    } catch {
      // Ignore parsing errors and continue.
    }
  }

  return `http://127.0.0.1:${DEFAULT_API_PORT}`;
}
