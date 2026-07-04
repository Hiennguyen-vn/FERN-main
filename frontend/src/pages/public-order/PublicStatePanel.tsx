import type { ReactNode } from 'react';

export function PublicStatePanel({
  eyebrow,
  title,
  description,
  action,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] px-6 py-10 text-center shadow-md">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-[hsl(var(--pos-accent)/0.25)] bg-[hsl(var(--pos-accent-soft))] text-[hsl(var(--pos-accent))]">
        {icon}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[hsl(var(--pos-accent))]">{eyebrow}</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
