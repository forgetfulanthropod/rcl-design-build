export function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function stamp(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace("T", " ").slice(0, 16);
}
