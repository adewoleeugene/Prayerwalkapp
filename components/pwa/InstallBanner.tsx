'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';

// Chrome/Edge fire this before showing their mini-bar. Not in TypeScript's lib yet.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type State =
  | { kind: 'idle' }
  | { kind: 'android'; deferred: BeforeInstallPromptEvent }
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

    // iOS Safari — no beforeinstallprompt and no banner needed
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    if (isIOS) { setState({ kind: 'done' }); return; }

    // Android / Chrome / Edge — capture the deferred prompt
    const handler = (e: Event) => {
      e.preventDefault();
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

  // ── Android / Chrome — native install prompt ─────────────────────────────────
  return (
    <div className="absolute bottom-28 inset-x-4 z-30 bg-white rounded-2xl shadow-xl border border-slate-200 p-4 flex items-center gap-3">
      {/* Icon */}
      <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
        <Download size={17} className="text-indigo-500" strokeWidth={2.5} />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-slate-800 mb-0.5">Install Prayer Walk</p>
        <p className="text-xs text-slate-500">Add to home screen for offline use</p>
      </div>

      {/* Install CTA */}
      <button
        onClick={() => void handleInstall()}
        className="bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl shrink-0 transition-colors"
      >
        Install
      </button>

      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        className="p-1 -mr-0.5 text-slate-300 hover:text-slate-500 rounded-lg"
        aria-label="Dismiss"
      >
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}
