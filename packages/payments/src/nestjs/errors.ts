import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { PaymentsError } from "../errors";
@Catch(PaymentsError)
export class PaymentsExceptionFilter implements ExceptionFilter {
  catch(error: PaymentsError, host: ArgumentsHost) {
    const status = error.status ?? (error.code === "contract" ? 502 : 503);
    host
      .switchToHttp()
      .getResponse()
      .status(status)
      .json({ statusCode: status, message: error.message, code: error.code });
  }
}
