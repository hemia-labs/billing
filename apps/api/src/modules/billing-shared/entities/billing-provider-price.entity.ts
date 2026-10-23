import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BillingProvider, ProviderPriceStatus } from '../enums';
import { BillingPlanPriceEntity } from './billing-plan-price.entity';

@Entity('provider_prices')
@Index('IDX_provider_prices_plan_price_id', ['planPriceId'])
@Index(
  'IDX_provider_prices_plan_price_provider_unique',
  ['planPriceId', 'provider'],
  {
    unique: true,
  },
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
