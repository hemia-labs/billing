import { PaypalBillingAdapter } from '../../../../apps/api/src/modules/providers/paypal-billing.adapter';

function fixture() {
  const plan = {
    status: 'ACTIVE',
    quantity_supported: false,
    billing_cycles: [
      {
        tenure_type: 'REGULAR',
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        pricing_scheme: {
          fixed_price: { value: '861.21', currency_code: 'MXN' },
        },
      },
    ],
    taxes: { percentage: '16.0', inclusive: false },
    payment_preferences: { setup_fee: { value: '0.0' } },
  };
  const client = { getPlan: jest.fn(() => Promise.resolve(plan)) };
  return { plan, adapter: new PaypalBillingAdapter(client as never) };
}
test('future renewal retains the original 861.21 plus 16 percent tax plan as exactly 999.00 gross', async () => {
  const f = fixture();
  await expect(
    f.adapter.validateFuturePlan('P-ORIGINAL', {
      amount: '999.00',
      currency: 'MXN',
      interval: 'monthly',
    }),
  ).resolves.toBeUndefined();
  expect(f.plan.billing_cycles[0].pricing_scheme.fixed_price.value).toBe(
    '861.21',
  );
});
test.each(['setup-fee', 'trial', 'currency', 'amount', 'quantity'])(
  'future renewal rejects unexpected %s',
  async (change) => {
    const f = fixture();
    if (change === 'setup-fee')
      f.plan.payment_preferences.setup_fee.value = '1.00';
    if (change === 'trial') f.plan.billing_cycles[0].tenure_type = 'TRIAL';
    if (change === 'currency')
      f.plan.billing_cycles[0].pricing_scheme.fixed_price.currency_code = 'USD';
    if (change === 'amount')
      f.plan.billing_cycles[0].pricing_scheme.fixed_price.value = '862.00';
    if (change === 'quantity') f.plan.quantity_supported = true;
    await expect(
      f.adapter.validateFuturePlan('P-ORIGINAL', {
        amount: '999.00',
        currency: 'MXN',
        interval: 'monthly',
      }),
    ).rejects.toMatchObject({ status: 409 });
  },
);
