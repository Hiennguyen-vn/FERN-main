import type { ReactNode } from 'react';

export function PublicShell({
  header,
  children,
  bottomPadding = false,
}: {
  header: ReactNode;
  children: ReactNode;
  bottomPadding?: boolean;
}) {
  return (
    <div className="brand-surface min-h-screen bg-[hsl(var(--pos-bg))] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-4 sm:px-6 lg:px-8">
        {header}
        <div className={bottomPadding ? 'flex-1 pb-28 pt-3 lg:pb-4' : 'flex-1 pt-3 sm:pt-4'}>
          {children}
        </div>
      </div>
    </div>
  );
}
