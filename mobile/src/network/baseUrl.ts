import { NativeModules } from 'react-native';

const DEFAULT_API_PORT = '3001';

function isTunnelHost(hostname: string): boolean {
  return hostname.endsWith('.exp.direct') || hostname.includes('exp.host') || hostname.endsWith('.expo.dev');
}

export function resolveApiBaseUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (envUrl) return envUrl;

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
