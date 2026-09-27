export type DatabaseSecret = {
  db_database: string;
  db_host: string;
  db_logging: boolean;
  db_password: string;
  db_port: number;
  db_username: string;
};

export function isDatabaseSecret(value: unknown): value is DatabaseSecret {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const secret = value as Record<string, unknown>;

  return (
    typeof secret.db_database === 'string' &&
    secret.db_database.trim().length > 0 &&
    typeof secret.db_host === 'string' &&
    secret.db_host.trim().length > 0 &&
    typeof secret.db_logging === 'boolean' &&
    typeof secret.db_password === 'string' &&
    typeof secret.db_port === 'number' &&
    Number.isInteger(secret.db_port) &&
    secret.db_port > 0 &&
    secret.db_port <= 65535 &&
    typeof secret.db_username === 'string' &&
    secret.db_username.trim().length > 0
  );
}
