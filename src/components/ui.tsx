import type { ButtonHTMLAttributes, ReactNode } from "react";

const tones = {
  copper: "bg-copper text-ink hover:opacity-90",
  ghost: "border border-line bg-raised text-fg hover:border-copper",
  quiet: "text-muted hover:text-fg",
} as const;

export function Button({
  tone = "copper",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof tones }) {
  return (
    <button
      {...props}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Chip({ children, hot = false }: { children: ReactNode; hot?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium ${
        hot ? "bg-copper text-ink" : "bg-raised text-fg"
      }`}
    >
      {children}
    </span>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <h2 className="mb-3 text-lg text-fg">{title}</h2>
      {children}
    </section>
  );
}

/** Glove-mode primary action: full width on phones, 56 px tall. */
export function BigButton({
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`glove-btn inline-flex w-full items-center justify-center gap-2 rounded-md bg-copper px-5 text-base font-semibold text-ink transition disabled:cursor-not-allowed disabled:opacity-50 md:w-auto ${className}`}
    >
      {children}
    </button>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div role="status" className="grid justify-items-start gap-2 rounded-md border border-dashed border-line p-5">
      <p className="text-base font-medium text-fg">{title}</p>
      {body ? <p className="text-base text-muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="grid gap-3">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton h-14 rounded-md" />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-danger bg-surface px-4 py-3">
      <p className="text-base text-danger">⚠ {message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="h-11 shrink-0 rounded-md border border-line px-4 text-base">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function OfflineBadge({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <p role="status" className="flex items-center gap-2 bg-danger px-4 py-2 text-base font-medium text-ink">
      ● Offline. Changes need signal to save.
    </p>
  );
}
