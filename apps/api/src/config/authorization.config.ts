import { registerAs } from '@nestjs/config';

export type AuthorizationMode = 'roles';

export default registerAs('authorization', () => {
  if ((process.env.HEMIA_AUTHORIZATION_MODE ?? 'roles') !== 'roles')
    throw new Error(
      'HEMIA_AUTHORIZATION_MODE must be roles; authenticated access is no longer supported',
    );
  return { mode: 'roles' as const };
});
