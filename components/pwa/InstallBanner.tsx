'use client';

import { useEffect, useRef, useState } from 'react';

// Chrome/Edge fire this before showing their mini-bar. TypeScript doesn't include it yet.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type State =
  | { kind: 'idle' }
  | { kind: 'android'; deferred: BeforeInstallPromptEvent }
  | { kind: 'ios' }
  | { kind: 'done' };

const DISMISSED_KEY = 'pwa_install_dismissed_until';

function isDismissed(): boolean {
  try {
    const until = localStorage.getItem(DISMISSED_KEY);
    return !!until && Date.now() < Number(until);
  } catch {
    return false;
  }
}

function dismiss7Days() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
  } catch { /* ignore */ }
}

export function InstallBanner() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const shown = useRef(false);

  useEffect(() => {
    // Already installed as a standalone PWA — never show
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).standalone === true;
    if (isStandalone || isDismissed()) { setState({ kind: 'done' }); return; }

    // iOS Safari — no beforeinstallprompt, so show manual instructions
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/chrome|chromium|crios|fxios/i.test(ua);
    if (isIOS && isSafari && !shown.current) {
      shown.current = true;
      // Delay 3 s so the user has a moment to orient before seeing the banner
      const t = setTimeout(() => setState({ kind: 'ios' }), 3000);
      return () => clearTimeout(t);
    }

    // Android / Chrome / Edge — capture the deferred prompt
    const handler = (e: Event) => {
      e.preventDefault(); // stop the mini-infobar
      if (!shown.current) {
        shown.current = true;
        setState({ kind: 'android', deferred: e as BeforeInstallPromptEvent });
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function handleDismiss() {
    dismiss7Days();
    setState({ kind: 'done' });
  }

  async function handleInstall() {
    if (state.kind !== 'android') return;
    try {
      await state.deferred.prompt();
      const { outcome } = await state.deferred.userChoice;
      if (outcome === 'accepted') setState({ kind: 'done' });
      else handleDismiss();
    } catch {
      handleDismiss();
    }
  }

  if (state.kind === 'idle' || state.kind === 'done') return null;

  // ── iOS instruction banner ──────────────────────────────────────────────────
  if (state.kind === 'ios') {
    return (
      <div className="absolute bottom-28 inset-x-4 z-30 bg-slate-900/97 text-white rounded-2xl shadow-2xl p-4 flex items-start gap-3 backdrop-blur">
        <span className="text-2xl mt-0.5">📱</span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm mb-1">Install Prayer Walk</p>
          <p className="text-xs text-slate-300 leading-snug">
            Tap the <span className="font-semibold text-white">Share</span> button
            {' '}(<span className="font-mono text-slate-200">⎙</span>){' '}
            then <span className="font-semibold text-white">Add to Home Screen</span>
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-slate-400 text-lg leading-none p-1 -mr-1 hover:text-white"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    );
  }

  // ── Android / Chrome install banner ────────────────────────────────────────
  return (
    <div className="absolute bottom-28 inset-x-4 z-30 bg-slate-900/97 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-3 backdrop-blur">
      <span className="text-2xl">📲</span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm mb-0.5">Install Prayer Walk</p>
        <p className="text-xs text-slate-300">Add to home screen for offline use</p>
      </div>
      <button
        onClick={() => void handleInstall()}
        className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold px-3 py-2 rounded-xl shrink-0 transition-colors"
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        className="text-slate-400 text-lg leading-none p-1 -mr-1 hover:text-white"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
