import { Module } from '@nestjs/common';
import { PaypalClientService } from './paypal-client.service';

@Module({
  providers: [PaypalClientService],
  exports: [PaypalClientService],
})
export class PaypalModule {}
