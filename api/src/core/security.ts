import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export const roles = ['member','operator','warehouse','support','finance','admin'] as const;
export type Role = typeof roles[number];
export const capabilities: Record<Role, string[]> = {
  member: [], operator: ['dashboard','products','orders'], warehouse: ['dashboard','stock','orders','fulfillment'],
  support: ['dashboard','orders','refunds'], finance: ['dashboard','settlements'],
  admin: ['dashboard','products','stock','orders','fulfillment','refunds','settlements','users','audit']
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
export function publicUser(user: Record<string, any>) { return { id: user.id, username: user.username, name: user.name, role: user.role, capabilities: capabilities[user.role as Role] || [] }; }
export const maskPhone = (phone: string) => phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
