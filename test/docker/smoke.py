"""Boot production Billing images without Vault against disposable dependencies."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]

with tempfile.TemporaryDirectory(prefix='billing-smoke-') as folder:
    folder = Path(folder)
    password = secrets.token_hex(24)
    issuer = 'https://identity.example.test'
    config = {
        'NODE_ENV': 'production', 'SECRETS_ENABLED': 'false',
        'BILLING_FISCAL_PROVIDER': 'disabled',
        'DB_HOST': 'smoke-db', 'DB_PORT': '5432', 'DB_USERNAME': 'billing',
        'DB_PASSWORD': password, 'DB_DATABASE': 'billing',
        'REDIS_HOST': 'smoke-redis', 'REDIS_PORT': '6379', 'REDIS_DB': '1',
        'REDIS_PASSWORD': password,
        'AMQP_URL': f'amqp://billing:{password}@smoke-rabbit:5672',
        'EVENT_BUS_ENABLED': 'true',
        'CORS_ORIGINS': 'https://billing.example.test',
        'AUTH_ISSUER_URL': issuer, 'AUTH_REQUIRED_ISSUER': issuer,
        'AUTH_JWKS_URI': issuer + '/.well-known/jwks.json', 'AUTH_AUDIENCE': 'billing-api',
        'SSO_ISSUER': issuer, 'SSO_CLIENT_ID': 'billing', 'SSO_CLIENT_SECRET': password,
        'SSO_AUDIENCE': 'billing-api', 'SSO_REDIRECT_URI': 'https://billing.example.test/auth/callback',
        'SSO_FRONTEND_URL': 'https://billing.example.test',
        'ACCESS_API_URL': 'https://access.example.test',
        'ACCESS_JWKS_URI': 'https://access.example.test/.well-known/jwks.json',
    }
    env_file = folder / 'production.env'
    env_file.write_text(''.join(f'{key}={value}\n' for key, value in config.items()))
    env_file.chmod(0o600)
    override = folder / 'compose.json'
    override.write_text(json.dumps({'services': {
        'smoke-db': {'image': 'postgres:18.4',
            'environment': {'POSTGRES_USER': 'billing', 'POSTGRES_PASSWORD': password, 'POSTGRES_DB': 'billing'},
            'tmpfs': ['/var/lib/postgresql'],
            'healthcheck': {'test': ['CMD-SHELL', 'pg_isready -U billing'], 'interval': '1s', 'timeout': '3s', 'retries': 60}},
        'smoke-redis': {'image': 'redis:8-alpine',
            'command': ['redis-server', '--save', '', '--appendonly', 'no', '--requirepass', password],
            'healthcheck': {'test': ['CMD', 'redis-cli', '-a', password, 'ping'], 'interval': '1s', 'timeout': '3s', 'retries': 60}},
        'smoke-rabbit': {'image': 'rabbitmq:4-alpine',
            'environment': {'RABBITMQ_DEFAULT_USER': 'billing', 'RABBITMQ_DEFAULT_PASS': password},
            'healthcheck': {'test': ['CMD', 'rabbitmq-diagnostics', '-q', 'ping'], 'interval': '3s', 'timeout': '5s', 'retries': 60}},
        'backend': {'depends_on': {name: {'condition': 'service_healthy'}
                                 for name in ['smoke-db', 'smoke-redis', 'smoke-rabbit']}},
    }}))
    environment = {**os.environ, 'BILLING_API_ENV_FILE': str(env_file),
                   'BILLING_BIND_ADDRESS': '127.0.0.1', 'BILLING_API_PORT': '0', 'BILLING_WEB_PORT': '0'}
    compose = ['docker', 'compose', '--env-file', '/dev/null', '-p',
               'billing-smoke-' + secrets.token_hex(4), '-f', str(ROOT / 'docker-compose.yml'), '-f', str(override)]
    def run(*args):
        r = subprocess.run(compose + list(args), cwd=ROOT, env=environment,
                           capture_output=True, text=True, timeout=300)
        if r.returncode:
            print((r.stdout + r.stderr).replace(password, '[REDACTED]'), flush=True)
            raise RuntimeError('Billing smoke command failed: ' + args[0])
        return r.stdout

    try:
        run('up', '-d', '--wait', '--wait-timeout', '120', 'smoke-db', 'smoke-redis', 'smoke-rabbit')
        preflight = "const d=require('./dist/data-source').AppDataSource;(async()=>{await d.initialize();if(!await d.showMigrations())throw Error('Expected pending migrations');await d.destroy()})().catch(()=>process.exit(1))"
        run('run', '--rm', '--no-deps', 'backend', 'node', '-e', preflight)
        run('run', '--rm', '--no-deps', 'backend', 'node', 'node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/data-source.js')
        run('up', '-d', '--no-build', '--wait', '--wait-timeout', '120')
        probe = "(async()=>{for(const [url,status] of [['http://backend:3015/api/v1',200],['http://backend:3015/auth/session',401],['http://frontend:5175',200]]){const r=await fetch(url,{signal:AbortSignal.timeout(5000)});if(r.status!==status)throw Error(url+' '+r.status)}if(process.getuid()===0||process.env.SECRETS_ENABLED!=='false')throw Error('Unsafe runtime')})().catch(e=>{console.error(e.message);process.exit(1)})"
        run('exec', '-T', 'backend', 'node', '-e', probe)
        print('PASS: production API and frontend boot without Vault; explicit migrations and anonymous session rejection verified', flush=True)
    except Exception:
        print(run('logs', '--tail', '40', 'backend').replace(password, '[REDACTED]'), flush=True)
        raise
    finally:
        run('down', '-v', '--remove-orphans')
