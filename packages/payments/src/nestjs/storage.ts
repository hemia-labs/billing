import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { EntityManager, DataSource } from "typeorm";
import {
  PAYMENTS_OPTIONS,
  type PaymentsRuntimeOptions,
  type PaymentsTransactionScope,
} from "./types";
export type AttemptRow = {
  id: string;
  organization_id: string;
  subject_id: string;
  product_code: string;
  idempotency_key: string;
  request_hash: string;
  request_payload: Record<string, unknown>;
  status: "pending" | "ready" | "rejected";
  checkout_id: string | null;
  subscription_id: string | null;
  checkout_url: string | null;
  checkout_status: string | null;
  subscription_status: string | null;
  status_checked_at: Date | string | null;
  error_code: string | null;
};
@Injectable()
export class PaymentsStorage {
  constructor(
    @Inject(PAYMENTS_OPTIONS)
    private readonly options: PaymentsRuntimeOptions & {
      dataSource: DataSource;
      scopeTransaction?: (
        manager: EntityManager,
        scope: PaymentsTransactionScope,
      ) => Promise<void>;
    },
  ) {}
  transaction<T>(
    scope: PaymentsTransactionScope,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.options.dataSource.transaction(async (manager) => {
      await this.options.scopeTransaction?.(manager, scope);
      return work(manager);
    });
  }
  async byId(
    manager: EntityManager,
    organizationId: string,
    id: string,
    lock = false,
  ): Promise<AttemptRow | null> {
    const rows: AttemptRow[] = await manager.query(
      // pg parses timestamptz as Date and drops microseconds needed by the status update's compare-and-swap.
      `SELECT *,status_checked_at::text AS status_checked_at FROM public.payments_checkout_attempts WHERE organization_id=$1 AND product_code=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`,
      [organizationId, this.options.connection.productCode, id],
    );
    return rows[0] ?? null;
  }
  async ready() {
    try {
      const columns: Record<string, string[]> = {
        payments_checkout_attempts: [
          "id",
          "organization_id",
          "subject_id",
          "product_code",
          "idempotency_key",
          "request_hash",
          "request_payload",
          "status",
          "checkout_id",
          "subscription_id",
          "checkout_url",
          "checkout_status",
          "subscription_status",
          "status_checked_at",
          "error_code",
        ],
        payments_licenses: [
          "organization_id",
          "product_code",
          "revision",
          "license",
          "confirmed_at",
          "received_at",
          "updated_at",
        ],
      };
      for (const [table, expected] of Object.entries(columns)) {
        const rows: { attname: string }[] = await this.options.dataSource.query(
          `SELECT a.attname FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`,
          [table],
        );
        if (expected.some((name) => !rows.some((r) => r.attname === name)))
          throw new Error();
      }
      const rows = await this.options.dataSource.query<{ ready: boolean }[]>(
        `SELECT to_regprocedure('public.payments_apply_license(uuid,text,bigint,jsonb,jsonb)') IS NOT NULL AS ready`,
      );
      if (rows[0]?.ready !== true) throw new Error();
      return { ready: true };
    } catch {
      throw new ServiceUnavailableException(
        "Payments schema unavailable; apply the explicit migration",
      );
    }
  }
}
