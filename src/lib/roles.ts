export const SUPER_ADMIN_NAME = "Elvira";
export const SUPER_ADMIN_PHONE = "+13523483841";
export const SUPER_ADMIN_PHONE_DISPLAY = "+1 352-348-3841";

export const ROLES = ["superadmin", "admin", "pm", "superintendent", "field", "office"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<string, number> = {
  superadmin: 0,
  admin: 1,
  pm: 2,
  superintendent: 3,
  office: 4,
  field: 5,
};

export function roleRank(role: string): number {
  return RANK[role] ?? 9;
}

export function roleLabel(role: string): string {
  if (role === "superadmin") return "Super admin";
  if (role === "pm") return "PM";
  if (!role) return "Crew";
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}

export function samePhone(raw: string | null | undefined, target = SUPER_ADMIN_PHONE): boolean {
  if (!raw) return false;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  if (digits.length < 11) return false;
  return `+${digits}` === target;
}

export function formatPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}
