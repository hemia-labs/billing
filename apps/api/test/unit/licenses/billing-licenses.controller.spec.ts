import { BillingLicensesController } from 'src/modules/licenses/billing-licenses.controller';
import { BillingLicensesService } from 'src/modules/licenses/billing-licenses.service';

describe('BillingLicensesController', () => {
  let service: { resolveLicense: jest.Mock };
  let controller: BillingLicensesController;

  beforeEach(() => {
    service = {
      resolveLicense: jest.fn().mockResolvedValue({ active: true }),
    };
    controller = new BillingLicensesController(
      service as unknown as BillingLicensesService,
    );
  });

  it('passes resolve query fields to service', async () => {
    await controller.resolve({
      organization_id: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
      product_code: 'medsync',
    });

    expect(service.resolveLicense).toHaveBeenCalledWith(
      '6dfce2ed-9704-43c5-9a40-9c03a047d653',
      'medsync',
    );
  });
});
