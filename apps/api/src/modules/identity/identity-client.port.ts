export const IDENTITY_CLIENT = Symbol('IDENTITY_CLIENT');

export type IdentityUser = {
  sub: string;
  email?: string;
  name?: string;
};

export type IdentityMembership = {
  organizationId: string;
  role?: string;
  scopes?: string[];
};

export type IdentityTeam = {
  id: string;
  name: string;
};

export interface IdentityClientPort {
  getUserBySub(sub: string): Promise<IdentityUser>;
  getUserByEmail(email: string): Promise<IdentityUser>;
  getMemberships(sub: string): Promise<IdentityMembership[]>;
  getTeams(): Promise<IdentityTeam[]>;
}
