import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingPaypalConnectionEntity } from '../billing-shared/entities/billing-paypal-connection.entity';
import { BillingProductEntity } from '../billing-shared/entities/billing-product.entity';
import { PaypalConnectionCrypto } from './paypal-connection.crypto';
import { PaypalConnectionsController } from './paypal-connections.controller';
import { PaypalConnectionsService } from './paypal-connections.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingPaypalConnectionEntity,
      BillingProductEntity,
    ]),
  ],
  controllers: [PaypalConnectionsController],
  providers: [PaypalConnectionsService, PaypalConnectionCrypto],
  exports: [PaypalConnectionsService],
})
export class PaypalConnectionsModule {}
