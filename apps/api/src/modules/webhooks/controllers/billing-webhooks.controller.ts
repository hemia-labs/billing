import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { BillingWebhooksService } from '../billing-webhooks.service';
import { BillingWebhookProcessResult, PaypalWebhookHeaders } from '../types';

@Controller('billing/webhooks')
export class BillingWebhooksController {
  constructor(private readonly service: BillingWebhooksService) {}

  @Post('paypal')
  @HttpCode(HttpStatus.OK)
  processPaypalWebhook(
    @Headers('paypal-transmission-id') transmissionId: string | undefined,
    @Headers('paypal-transmission-time') transmissionTime: string | undefined,
    @Headers('paypal-cert-url') certUrl: string | undefined,
    @Headers('paypal-auth-algo') authAlgo: string | undefined,
    @Headers('paypal-transmission-sig') transmissionSig: string | undefined,
    @Body() payload: Record<string, unknown>,
  ): Promise<BillingWebhookProcessResult> {
    return this.service.processPaypalWebhook(
      this.buildHeaders({
        transmissionId,
        transmissionTime,
        certUrl,
        authAlgo,
        transmissionSig,
      }),
      payload,
    );
  }

  private buildHeaders(headers: {
    transmissionId?: string;
    transmissionTime?: string;
    certUrl?: string;
    authAlgo?: string;
    transmissionSig?: string;
  }): PaypalWebhookHeaders {
    const missingHeader = Object.entries(headers).find(
      ([, value]) => !value?.trim(),
    );

    if (missingHeader) {
      throw new BadRequestException(
        `Missing PayPal header: ${missingHeader[0]}`,
      );
    }

    return headers as PaypalWebhookHeaders;
  }
}
