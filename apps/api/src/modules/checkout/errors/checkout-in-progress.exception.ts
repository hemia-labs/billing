import { ConflictException } from '@nestjs/common';

export class CheckoutInProgressException extends ConflictException {
  constructor(
    checkoutId: string,
    readonly retryAfterSeconds: number,
  ) {
    super({
      statusCode: 409,
      code: 'CHECKOUT_IN_PROGRESS',
      message:
        'Checkout attempt is in progress; retry with the same idempotency key',
      checkoutId,
      retryAfterSeconds,
    });
  }
}
