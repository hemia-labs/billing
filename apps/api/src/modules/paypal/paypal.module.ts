import { PaypalConnectionsModule } from '../paypal-connections/paypal-connections.module';
import { Module } from '@nestjs/common';
import { PaypalClientService } from './paypal-client.service';

@Module({
  imports: [PaypalConnectionsModule],
  providers: [PaypalClientService],
  exports: [PaypalClientService],
})
export class PaypalModule {}
