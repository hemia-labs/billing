import { registerAs } from '@nestjs/config';

export type AuthorizationMode = 'roles' | 'authenticated';

export default registerAs('authorization', () => ({
  mode: (process.env.HEMIA_AUTHORIZATION_MODE ?? 'roles') as AuthorizationMode,
}));
