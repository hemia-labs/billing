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
import { BillingAddonEntity } from './billing-addon.entity';

@Entity('addon_provider_prices')
@Index('IDX_addon_provider_prices_addon_id', ['addonId'])
@Index('IDX_addon_provider_prices_scope_active_unique', { synchronize: false })
@Check(
  'CHK_addon_provider_prices_connection_scope',
  `("connection_scope" IN ('unassigned','global') AND "provider_connection_id" IS NULL) OR ("connection_scope"='connection' AND "provider_connection_id" IS NOT NULL AND "provider"='paypal')`,
)
@Index('IDX_addon_provider_prices_provider_price_id', ['providerPriceId'])
export class BillingAddonProviderPriceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'addon_id', type: 'uuid' })
  addonId: string;

  @ManyToOne(() => BillingAddonEntity, (addon) => addon.providerPrices, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'addon_id' })
  addon: BillingAddonEntity;

  @Column({
    type: 'enum',
    enum: BillingProvider,
    enumName: 'provider_prices_provider_enum',
  })
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
    enumName: 'provider_prices_status_enum',
    default: ProviderPriceStatus.Active,
  })
  status: ProviderPriceStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
