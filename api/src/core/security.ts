import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export const roles = ['member','operator','warehouse','support','finance','admin'] as const;
export type Role = typeof roles[number];
export const staffRoles = ['operator','warehouse','support','finance','admin'] as const;
export type AccountType = 'member' | 'staff';
export const accountType = (role: string): AccountType | undefined => role === 'member' ? 'member' : staffRoles.includes(role as typeof staffRoles[number]) ? 'staff' : undefined;
export const capabilities: Record<Role, string[]> = {
  member: [], operator: ['dashboard','catalog.read','products','orders','promotions'], warehouse: ['dashboard','catalog.read','stock','orders','fulfillment'],
  support: ['dashboard','orders','refunds'], finance: ['dashboard','settlements'],
  admin: ['dashboard','catalog.read','products','products.delete','promotions','stock','orders','orders.manage','orders.delete','fulfillment','refunds','settlements','users','users.delete','audit']
};
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function publicUser(user: Record<string, any>) { return { id: user.id, username: user.username, name: user.name, role: user.role, active: user.active ?? 1, created_at: user.created_at, accountType: accountType(user.role), capabilities: capabilities[user.role as Role] || [] }; }
export const maskPhone = (phone: string) => phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
