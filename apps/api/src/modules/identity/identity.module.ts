import { Module } from '@nestjs/common';
import { IDENTITY_CLIENT } from './identity-client.port';
import { NoopIdentityClient } from './noop-identity-client.service';

@Module({
  providers: [
    NoopIdentityClient,
    {
      provide: IDENTITY_CLIENT,
      useExisting: NoopIdentityClient,
    },
  ],
  exports: [IDENTITY_CLIENT],
})
export class IdentityModule {}
