import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BillingProvider, ProviderPriceStatus } from '../enums';
import { BillingPaypalConnectionEntity } from './billing-paypal-connection.entity';
import { BillingPlanPriceEntity } from './billing-plan-price.entity';

@Entity('provider_prices')
@Index('IDX_provider_prices_plan_price_id', ['planPriceId'])
@Index('IDX_provider_prices_scope_active_unique', { synchronize: false })
@Check(
  'CHK_provider_prices_connection_scope',
  `("connection_scope" IN ('unassigned','global') AND "provider_connection_id" IS NULL) OR ("connection_scope"='connection' AND "provider_connection_id" IS NOT NULL AND "provider"='paypal')`,
)
@Index('IDX_provider_prices_provider_price_id', ['providerPriceId'])
export class BillingProviderPriceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_price_id', type: 'uuid' })
  planPriceId: string;

  @ManyToOne(() => BillingPlanPriceEntity, (price) => price.providerPrices, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'plan_price_id' })
  planPrice: BillingPlanPriceEntity;

  @Column({ type: 'enum', enum: BillingProvider })
  provider: BillingProvider;

  @Column({
    name: 'connection_scope',
    type: 'varchar',
    length: 10,
    default: 'unassigned',
  })
  connectionScope: 'unassigned' | 'global' | 'connection';

  @Column({ name: 'provider_connection_id', type: 'uuid', nullable: true })
  providerConnectionId: string | null;

  @ManyToOne(() => BillingPaypalConnectionEntity, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'provider_connection_id' })
  providerConnection: BillingPaypalConnectionEntity | null;

  @Column({
    name: 'provider_product_id',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  providerProductId: string | null;

  @Column({
    name: 'provider_price_id',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  providerPriceId: string | null;

  @Column({
    name: 'provider_metadata',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  providerMetadata: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: ProviderPriceStatus,
    default: ProviderPriceStatus.Active,
  })
  status: ProviderPriceStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
