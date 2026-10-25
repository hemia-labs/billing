import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import {
  BillingSubscriptionEntity,
  SubscriptionStatus,
} from '../billing-shared';
import { BillingLicensesService } from './billing-licenses.service';
import {
  cancellationIntent,
  hasPaidCancellationAccess,
  pendingPlanChange,
  planChangeResponse,
} from '../subscriptions-management/subscription-management-state';

const PRIORITY = [
  SubscriptionStatus.Active,
  SubscriptionStatus.PastDue,
  SubscriptionStatus.Cancelled,
  SubscriptionStatus.Pending,
];

@Injectable()
export class BillingSnapshotsService {
  constructor(
    private readonly db: DataSource,
    private readonly licenses: BillingLicensesService,
  ) {}

  async current(organizationId: string, productCode: string) {
    organizationId = organizationId.toLowerCase();
    const runner = this.db.createQueryRunner();
    await runner.connect();
    const key = JSON.stringify([
      'billing.snapshot',
      organizationId,
      productCode,
    ]);
    let locked = false;
    try {
      // Acquire before starting the snapshot so a waiter cannot publish older data with a newer revision.
      await runner.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
        key,
      ]);
      locked = true;
      await runner.startTransaction('REPEATABLE READ');
      const [clock] = (await runner.query(
        `SELECT nextval('billing_license_revision_seq')::text AS revision, clock_timestamp() AS "confirmedAt"`,
      )) as { revision: string; confirmedAt: Date }[];
      const license = await this.licenses.resolveLicense(
        organizationId,
        productCode,
        runner.manager,
      );
      const rows = await runner.manager
        .getRepository(BillingSubscriptionEntity)
        .find({
          where: {
            organizationId,
            productCode,
            ...(license.subscriptionId
              ? { id: license.subscriptionId }
              : { status: In(PRIORITY) }),
          },
          order: { updatedAt: 'DESC' },
        });
      const eligible = rows
        .filter(
          (s) =>
            !!license.subscriptionId ||
            s.status !== SubscriptionStatus.Cancelled ||
            hasPaidCancellationAccess(s),
        )
        .sort(
          (a, b) =>
            PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status) ||
            b.updatedAt.getTime() - a.updatedAt.getTime(),
        );
      const current =
        (license.subscriptionId
          ? eligible.find((s) => s.id === license.subscriptionId)
          : undefined) ?? eligible[0];
      const change = current ? pendingPlanChange(current) : null;
      const cancellation = current ? cancellationIntent(current) : null;
      const snapshot = {
        organizationId,
        productCode,
        revision: clock.revision,
        confirmedAt: clock.confirmedAt.toISOString(),
        license,
        subscription: current
          ? {
              id: current.id,
              organizationId,
              productCode,
              planCode: current.planCode,
              planPriceCode: current.planPriceCode ?? null,
              status: current.status,
              currentPeriodEnd: current.currentPeriodEnd?.toISOString() ?? null,
              nextBillingTime: current.nextBillingTime?.toISOString() ?? null,
              cancelAtPeriodEnd: current.cancelAtPeriodEnd,
              cancellation: cancellation
                ? {
                    state: cancellation.state,
                    requestedAt: cancellation.requestedAt,
                    effectiveAt: cancellation.effectiveAt,
                  }
                : null,
              pendingPlanChange:
                change && change.state !== 'failed'
                  ? {
                      ...planChangeResponse(change),
                      // Organization snapshots omit buyer approval links; recover them from the owned payment attempt.
                      checkoutUrl: null,
                      targetPlanCode: change.targetPlanCode,
                      targetPlanPriceCode: change.targetPlanPriceCode,
                      checkoutId: change.checkoutId,
                      newSubscriptionId: current.id,
                    }
                  : null,
            }
          : null,
      };
      await runner.commitTransaction();
      return snapshot;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      try {
        if (locked)
          await runner.query(
            'SELECT pg_advisory_unlock(hashtextextended($1,0))',
            [key],
          );
      } finally {
        await runner.release();
      }
    }
  }
}
