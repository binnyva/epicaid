/** Who may sign in. ADMIN_EMAIL always may, and is always an admin; everyone else needs the allow-list. */

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export function isBootstrapAdmin(email: string, adminEmail = process.env.ADMIN_EMAIL): boolean {
  return !!adminEmail && normaliseEmail(email) === normaliseEmail(adminEmail);
}

export function maySignIn(email: string, allowed: readonly string[], adminEmail = process.env.ADMIN_EMAIL): boolean {
  const e = normaliseEmail(email);
  return isBootstrapAdmin(e, adminEmail) || allowed.some((a) => normaliseEmail(a) === e);
}
