import type { ModuleMetadata } from "@nestjs/common";
import type { PaymentsConnection } from "../index";
import type {
  PaymentsContext,
  PaymentsOperation,
  PaymentsReceiverOptions,
  PaymentsLegalInput,
  PaymentsLegalOptions,
  SnapshotSink,
} from "../contracts";
export * from "../contracts";
export const SERVICE_AUTHENTICATED_METADATA =
  "hemia.payments.service-authenticated";
export const PAYMENTS_OPTIONS = Symbol("HEMIA_PAYMENTS_OPTIONS");
export type PaymentsModuleOptions = {
  connection: PaymentsConnection | string;
  clientSecret: string;
  authorize: (
    request: unknown,
    operation: PaymentsOperation,
  ) => Promise<PaymentsContext>;
  returnUrls?: (
    context: PaymentsContext,
    attemptId: string,
  ) => Promise<{ successUrl: string; cancelUrl: string }>;
  receiver?: PaymentsReceiverOptions;
  legal?: PaymentsLegalInput;
  onSnapshot?: SnapshotSink;
};
export type PaymentsAsyncOptions = Pick<ModuleMetadata, "imports"> & {
  inject?: any[];
  useFactory: (
    ...dependencies: any[]
  ) => PaymentsModuleOptions | Promise<PaymentsModuleOptions>;
};
export type PaymentsRuntimeOptions = Omit<
  PaymentsModuleOptions,
  "connection" | "receiver" | "legal"
> & {
  connection: PaymentsConnection;
  legal?: PaymentsLegalOptions;
  receiver: Required<PaymentsReceiverOptions>;
};
