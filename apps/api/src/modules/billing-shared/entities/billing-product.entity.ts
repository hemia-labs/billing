import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BillingProductStatus } from '../enums';

@Entity('products')
@Index('IDX_products_code_active_unique', ['code'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class BillingProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 80 })
  code: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: BillingProductStatus,
    default: BillingProductStatus.Active,
  })
  status: BillingProductStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
