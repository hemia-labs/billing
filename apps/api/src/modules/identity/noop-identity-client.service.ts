import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  IdentityClientPort,
  IdentityMembership,
  IdentityTeam,
  IdentityUser,
} from './identity-client.port';

@Injectable()
export class NoopIdentityClient implements IdentityClientPort {
  async getUserBySub(): Promise<IdentityUser> {
    return this.notImplemented();
  }

  async getUserByEmail(): Promise<IdentityUser> {
    return this.notImplemented();
  }

  async getMemberships(): Promise<IdentityMembership[]> {
    return this.notImplemented();
  }

  async getTeams(): Promise<IdentityTeam[]> {
    return this.notImplemented();
  }

  private notImplemented(): never {
    throw new NotImplementedException(
      'IdentityClientPort is pending @hemia/auth SsoClient integration',
    );
  }
}
