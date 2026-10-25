import { Inject, Injectable } from "@nestjs/common";
import { PaymentsLegalClient } from "../legal";
import { PAYMENTS_OPTIONS, type PaymentsRuntimeOptions } from "./types";
@Injectable()
export class PaymentsLegalService extends PaymentsLegalClient {
  constructor(@Inject(PAYMENTS_OPTIONS) options: PaymentsRuntimeOptions) {
    super(options);
  }
}
