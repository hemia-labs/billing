export type RedisSecret = {
  redis_db: number;
  redis_host: string;
  redis_password: string;
  redis_port: number;
};

export function isRedisSecret(value: unknown): value is RedisSecret {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const secret = value as Record<string, unknown>;

  return (
    typeof secret.redis_db === 'number' &&
    Number.isInteger(secret.redis_db) &&
    secret.redis_db >= 0 &&
    typeof secret.redis_host === 'string' &&
    secret.redis_host.trim().length > 0 &&
    typeof secret.redis_password === 'string' &&
    typeof secret.redis_port === 'number' &&
    Number.isInteger(secret.redis_port) &&
    secret.redis_port > 0 &&
    secret.redis_port <= 65535
  );
}
