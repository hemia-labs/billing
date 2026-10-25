import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { CheckoutInProgressException } from '../errors/checkout-in-progress.exception';

@Catch(CheckoutInProgressException)
export class CheckoutInProgressFilter implements ExceptionFilter {
  catch(exception: CheckoutInProgressException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
