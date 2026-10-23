import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { BillingWebhooksConsoleController } from '../../../../apps/api/src/modules/webhooks/controllers/billing-webhooks-console.controller';

const eventId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';

describe('Webhook detail history authorization', () => {
  function fixture(
    owner: string | null,
    role = 'billing.integration_operator',
  ) {
    const database = {
      query: jest.fn().mockResolvedValue([{ organization_id: owner }]),
    };
    const guard = new PermissionsGuard(
      new Reflector(),
      database as never,
      {} as never,
    );
    const req = {
      principal: { sub: 'operator', isMachine: false },
      params: { id: eventId },
      billingAuthorization: {
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        assignments: [
          {
            assignment_id: eventId,
            assignment_version: 1,
            role_code: role,
            scope: {
              type: 'organizations',
              organization_ids: [organizationId],
            },
            valid_from: 1,
            expires_at: null,
          },
        ],
      },
    };
    const context = {
      getHandler: () =>
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflector reads metadata without calling the handler.
        BillingWebhooksConsoleController.prototype.listManualRetries,
      getClass: () => BillingWebhooksConsoleController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { guard, context, database };
  }

  it('authorizes history using the webhook owner and explicit read permission', async () => {
    const f = fixture(organizationId);
    await expect(f.guard.canActivate(f.context)).resolves.toBe(true);
    expect(f.database.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM webhook_events w WHERE w.id=$1'),
      [eventId],
    );
  });

  it.each([null, '33333333-3333-4333-8333-333333333333'])(
    'denies a webhook outside the operator scope (%s)',
    async (owner) => {
      const f = fixture(owner);
      await expect(f.guard.canActivate(f.context)).rejects.toThrow(
        ForbiddenException,
      );
    },
  );

  it('denies roles without webhook read access', async () => {
    const f = fixture(organizationId, 'billing.viewer');
    await expect(f.guard.canActivate(f.context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(f.database.query).not.toHaveBeenCalled();
  });
});
