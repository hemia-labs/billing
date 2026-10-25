import { Inject, Injectable, HttpException } from "@nestjs/common";
import { ServiceTokens } from "../service-tokens";
export { validateServiceClaims } from "../service-tokens";
import { PaymentsError } from "../errors";
import { PAYMENTS_OPTIONS, type PaymentsRuntimeOptions } from "./types";
@Injectable()
export class PaymentsServiceTokens extends ServiceTokens {
  constructor(@Inject(PAYMENTS_OPTIONS) options: PaymentsRuntimeOptions) {
    super({
      ...options,
      connection: { ...options.connection, clientSecret: options.clientSecret },
    });
  }
  override async verifyActive(token: string, client: string, scope: string) {
    try {
      return await super.verifyActive(token, client, scope);
    } catch (error) {
      if (error instanceof PaymentsError)
        throw new HttpException(error.message, error.status ?? 401);
      throw error;
    }
  }
}
