'use client';

type Props = {
  isActive: boolean;
  onDismiss?: () => void;
};

export function WakeLockBanner({ isActive, onDismiss }: Props) {
  if (isActive) {
    return (
      <div className="flex items-center gap-1.5 bg-emerald-600/90 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        Screen staying on
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-amber-500/95 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow">
      <span>⚠ Screen locked — GPS paused</span>
      {onDismiss && (
        <button onClick={onDismiss} className="underline opacity-90 hover:opacity-100">
          Resume
        </button>
      )}
    </div>
  );
}
