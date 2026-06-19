import { NotImplementedException } from '@nestjs/common';
import { NoopIdentityClient } from 'src/modules/identity/noop-identity-client.service';

describe('NoopIdentityClient', () => {
  it('fails explicitly until @hemia/auth SsoClient integration is added', async () => {
    const client = new NoopIdentityClient();

    await expect(client.getUserBySub('user-sub')).rejects.toThrow(
      NotImplementedException,
    );
  });
});
