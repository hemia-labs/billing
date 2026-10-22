import { Module, type DynamicModule } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DataSource } from "typeorm";
import { createPaymentsClient, type PaymentsConnection } from "../index";
import { endpoint, record } from "./validation";
import {
  PaymentsController,
  PaymentsLegalController,
  PaymentsMachineController,
  PaymentsMachineGuard,
} from "./controllers";
import { PaymentsService } from "./payments.service";
import { PaymentsStorage } from "./storage";
import { PaymentsServiceTokens } from "./service-tokens";
import { PaymentsLegalService } from "./legal.service";
import {
  PAYMENTS_OPTIONS,
  type PaymentsAsyncOptions,
  type PaymentsRuntimeOptions,
  type PaymentsLegalOptions,
} from "./types";
export * from "./types";
export { PaymentsService } from "./payments.service";
export { PaymentsSchema1792886400000 } from "./schema";
@Module({})
export class PaymentsModule {
  static forRootAsync(options: PaymentsAsyncOptions): DynamicModule {
    return {
      module: PaymentsModule,
      imports: options.imports ?? [],
      controllers: [
        PaymentsController,
        PaymentsMachineController,
        PaymentsLegalController,
      ],
      providers: [
        {
          provide: PAYMENTS_OPTIONS,
          inject: [
            { token: DataSource, optional: true },
            ...(options.inject ?? []),
          ],
          useFactory: async (
            hostDataSource: DataSource | undefined,
            ...dependencies: unknown[]
          ): Promise<PaymentsRuntimeOptions> => {
            const value = await options.useFactory(...dependencies);
            let c: PaymentsConnection;
            try {
              const parsed: unknown =
                typeof value.connection === "string"
                  ? JSON.parse(value.connection)
                  : value.connection;
              if (!record(parsed)) throw new Error();
              c = parsed as PaymentsConnection;
              createPaymentsClient({ ...c, clientSecret: value.clientSecret });
            } catch {
              throw new Error("Invalid PAYMENTS_CONNECTION or client secret");
            }
            const dataSource = value.dataSource ?? hostDataSource;
            if (!dataSource)
              throw new Error(
                "Payments requires the host TypeORM DataSource; import your database module or provide dataSource explicitly",
              );
            if (typeof value.authorize !== "function")
              throw new Error("Payments requires an authorize callback");
            let legal: PaymentsLegalOptions | undefined;
            if (value.legal !== undefined) {
              const merged = { ...c.legal, ...value.legal };
              if (
                !merged.baseUrl ||
                !merged.audience ||
                !merged.resource ||
                !merged.verificationClientId ||
                typeof merged.resolveContext !== "function"
              )
                throw new Error(
                  "Payments Legal requires connection.legal configuration and a resolveContext callback",
                );
              try {
                endpoint(merged.baseUrl, c.allowHttpLoopback === true);
                endpoint(merged.resource, c.allowHttpLoopback === true);
              } catch {
                throw new Error(
                  "Invalid Payments Legal endpoint configuration",
                );
              }
              legal = merged as PaymentsLegalOptions;
            }
            const receiver = value.receiver ?? c.receiver;
            const token = new URL(c.tokenUrl);
            token.pathname = token.pathname.replace(/\/token$/, "/introspect");
            if (!token.pathname.endsWith("/introspect"))
              throw new Error("Configure an OAuth token endpoint");
            return {
              ...value,
              connection: c,
              dataSource,
              legal,
              receiver: {
                audience: receiver?.audience ?? "",
                billingClientId: receiver?.billingClientId ?? "",
                consoleClientId: receiver?.consoleClientId ?? "",
                jwksUrl:
                  value.receiver?.jwksUrl ??
                  new URL("/.well-known/jwks.json", c.issuer).href,
                introspectionUrl:
                  value.receiver?.introspectionUrl ?? token.href,
              },
            };
          },
        },
        Reflector,
        PaymentsStorage,
        PaymentsServiceTokens,
        PaymentsMachineGuard,
        PaymentsLegalService,
        PaymentsService,
      ],
      exports: [PaymentsService],
    };
  }
}
