export const SUPER_ADMIN_NAME = "Elvira";
export const SUPER_ADMIN_PHONE = "+13523483841";
export const SUPER_ADMIN_PHONE_DISPLAY = "+1 352-348-3841";

/**
 * Personas. `superadmin` is Elvira: an owner who also approves code proposals.
 * Legacy roles (pm, office, superintendent, field) are mapped by normalizeRole
 * and rewritten by migration 0004.
 */
export const ROLES = ["superadmin", "owner", "admin", "lead", "labor", "sub"] as const;
export type Role = (typeof ROLES)[number];

export const LEGACY_ROLES: Record<string, Role> = {
  pm: "admin",
  office: "admin",
  superintendent: "lead",
  field: "labor",
  subcontractor: "sub",
};

export function normalizeRole(raw: string | null | undefined): Role | null {
  const value = (raw ?? "").trim().toLowerCase();
  if ((ROLES as readonly string[]).includes(value)) return value as Role;
  return LEGACY_ROLES[value] ?? null;
}

const RANK: Record<Role, number> = { superadmin: 0, owner: 1, admin: 2, lead: 3, labor: 4, sub: 5 };

export function roleRank(role: string): number {
  const r = normalizeRole(role);
  return r ? RANK[r] : 9;
}

const LABELS: Record<Role, string> = {
  superadmin: "Owner (super admin)",
  owner: "Owner",
  admin: "Admin",
  lead: "Lead",
  labor: "Labor",
  sub: "Subcontractor",
};

export function roleLabel(role: string): string {
  const r = normalizeRole(role);
  return r ? LABELS[r] : "Crew";
}

/** Field roles work from a phone and never see money. */
export function isFieldRole(role: string): boolean {
  const r = normalizeRole(role);
  return r === "labor" || r === "sub";
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
