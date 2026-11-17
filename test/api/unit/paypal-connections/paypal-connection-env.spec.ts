import { envVarsSchema } from '../../../../apps/api/src/config/env.validation';

const field = envVarsSchema.extract('PAYPAL_CONNECTION_ENCRYPTION_KEY');
const syntheticKey = Buffer.alloc(32, 91).toString('base64');
describe('PayPal encryption environment validation redaction', () => {
  it.each([
    syntheticKey + ' ',
    'synthetic-sensitive-invalid-key',
    928374652,
    { secret: 'synthetic-object-secret' },
    ['synthetic-array-secret'],
  ])('never echoes invalid key input (%#)', (value) => {
    const { error } = field.validate(value);
    expect(error).toBeDefined();
    expect(error!.message).toBe(
      'PAYPAL_CONNECTION_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
    expect(error!.message).not.toContain(syntheticKey);
    expect(error!.message).not.toContain('synthetic-sensitive');
    expect(error!.message).not.toContain('synthetic-object');
    expect(error!.message).not.toContain('synthetic-array');
    expect(error!.message).not.toContain('928374652');
  });
  it.each([undefined, '', syntheticKey])(
    'accepts absent, disabled or valid configuration (%#)',
    (value) => {
      expect(field.validate(value).error).toBeUndefined();
    },
  );
});
