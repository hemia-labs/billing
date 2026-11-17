import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as billingEntities from '../modules/billing-shared/entities';
import { BillingServiceClientEntity } from '../common/entities/billing-service-client.entity';
import { BillingPaymentAttemptEntity } from '../modules/payment-attempts/billing-payment-attempt.entity';

export const READINESS_ENTITIES = [
  ...Object.values(billingEntities),
  BillingServiceClientEntity,
  BillingPaymentAttemptEntity,
];

interface ReadinessConnection {
  query(config: { text: string; query_timeout: number }): Promise<unknown>;
}

@Controller('health')
export class DatabaseReadinessController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('ready')
  async ready() {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (
        !this.dataSource.isInitialized ||
        READINESS_ENTITIES.some(
          (entity) =>
            !this.dataSource.hasMetadata(entity) ||
            this.dataSource.getMetadata(entity).target !== entity,
        )
      )
        throw new Error('Database metadata unavailable');
      await Promise.race([
        this.probe(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Database readiness timed out')),
            2500,
          );
        }),
      ]);
      return { status: 'ok', service: 'billing' };
    } catch {
      throw new HttpException(
        { status: 'unavailable', service: 'billing' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async probe(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    try {
      const connection = (await runner.connect()) as ReadinessConnection;
      await connection.query({ text: 'SELECT 1', query_timeout: 2000 });
    } finally {
      await runner.release();
    }
  }
}
