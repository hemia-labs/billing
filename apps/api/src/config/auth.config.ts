import { registerAs } from '@nestjs/config';

const optionalString = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export default registerAs('auth', () => ({
  issuerUrl: optionalString(process.env.AUTH_ISSUER_URL),
  jwksUri: optionalString(process.env.AUTH_JWKS_URI),
  audience: optionalString(process.env.AUTH_AUDIENCE),
  requiredIssuer: optionalString(process.env.AUTH_REQUIRED_ISSUER),
}));
