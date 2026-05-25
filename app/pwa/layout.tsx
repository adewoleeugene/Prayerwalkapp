import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Charis Prayer Walk',
};

export default function PWALayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 overflow-hidden bg-slate-900"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {children}
    </div>
  );
}
