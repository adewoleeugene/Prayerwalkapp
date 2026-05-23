import { NativeModules } from 'react-native';

const DEFAULT_API_PORT = '3000';
const PROD_API_BASE_URL = 'https://prayerwalkapp.vercel.app';

function isTunnelHost(hostname: string): boolean {
  return hostname.endsWith('.exp.direct') || hostname.includes('exp.host') || hostname.endsWith('.expo.dev');
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function shouldUseEnvUrlInRelease(url: string): boolean {
  try {
    const parsed = new URL(url);
    const protocolOk = parsed.protocol === 'https:' || parsed.protocol === 'http:';
    if (!protocolOk) return false;

    // Physical devices cannot reach localhost/127 loopback of the build host.
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return false;
    }

    // Allow private/LAN hosts in release when explicitly configured.
    return true;
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
        // Same LAN — Metro host is the dev machine's local IP
        return `http://${metroHost}:${DEFAULT_API_PORT}`;
      }
      // Expo tunnel: Metro is on exp.direct but Next.js is still on the dev machine.
      // Use the env-configured local IP if set, otherwise fall back to Vercel.
      if (isTunnelHost(metroHost)) {
        return PROD_API_BASE_URL;
      }
    } catch {
      // Ignore parsing errors and continue.
    }
  }

  return `http://127.0.0.1:${DEFAULT_API_PORT}`;
}
