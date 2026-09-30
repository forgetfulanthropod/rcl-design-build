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
