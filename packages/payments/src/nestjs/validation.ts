import { HttpException } from "@nestjs/common";
import * as shared from "../validation";
import { PaymentsError } from "../errors";
export { uuid, record, text, endpoint, exact } from "../validation";
function adapt<F extends (...args: any[]) => any>(fn: F): F {
  return ((...args: Parameters<F>) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof PaymentsError)
        throw new HttpException(error.message, error.status ?? 400);
      throw error;
    }
  }) as F;
}
export const context: typeof shared.context = adapt(shared.context);
export const attemptInput = adapt(shared.attemptInput);
export const cancellationInput = adapt(shared.cancellationInput);
export const prepareInput = adapt(shared.prepareInput);
export const acceptInput = adapt(shared.acceptInput);
export const legalContextInput = adapt(shared.legalContextInput);
export const webhookInput = adapt(shared.webhookInput);
export const planChangeQuoteInput = adapt(shared.planChangeQuoteInput);

export const resumeRenewalInput = adapt(shared.resumeRenewalInput);

export const changeRenewalPlanInput = adapt(shared.changeRenewalPlanInput);
