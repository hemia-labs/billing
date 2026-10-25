import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  IdentityClientPort,
  IdentityMembership,
  IdentityTeam,
  IdentityUser,
} from './identity-client.port';

@Injectable()
export class NoopIdentityClient implements IdentityClientPort {
  getUserBySub(): Promise<IdentityUser> {
    return this.notImplemented();
  }

  getUserByEmail(): Promise<IdentityUser> {
    return this.notImplemented();
  }

  getMemberships(): Promise<IdentityMembership[]> {
    return this.notImplemented();
  }

  getTeams(): Promise<IdentityTeam[]> {
    return this.notImplemented();
  }

  private notImplemented(): Promise<never> {
    return Promise.reject(
      new NotImplementedException(
        'IdentityClientPort is pending @hemia/auth SsoClient integration',
      ),
    );
  }
}
