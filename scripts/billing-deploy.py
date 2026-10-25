"""Linux host controller: deploy released images, explicit migrations, or rollback."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request


def read_manifest(directory, registry_host='registry.tail41610c.ts.net'):
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', registry_host):
        raise ValueError('Invalid registry hostname')
    directory = Path(directory)
    data = json.loads((directory / 'release.json').read_text())
    if data.get('schema') != 1 or not re.fullmatch(r'billing-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', data.get('tag', '')):
        raise ValueError('Invalid Billing release')
    if not re.fullmatch('[a-f0-9]{40}', data.get('commit', '')):
        raise ValueError('Invalid commit')
    if not isinstance(data.get('migrations'), dict) or any(
        not re.fullmatch(r'[A-Za-z0-9_-]+\.ts', name) or not re.fullmatch('[a-f0-9]{64}', value)
        for name, value in data['migrations'].items()
    ):
        raise ValueError('Invalid migration manifest')
    if data.get('registry') != registry_host:
        raise ValueError('Release uses an unexpected registry')
    for name in ['compose.json', 'billing-deploy.py']:
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != data['files'][name]:
            raise ValueError('Invalid release checksum: ' + name)
    compose = json.loads((directory / 'compose.json').read_text())
    if set(compose['services']) != {'backend', 'frontend'}:
        raise ValueError('Unexpected services')
    for service in ['backend', 'frontend']:
        image = data['images'][service]
        if not re.fullmatch(re.escape(registry_host) + '/billing/' + service + r'@sha256:[a-f0-9]{64}', image):
            raise ValueError('Unpinned or unexpected image')
        if compose['services'][service].get('build') or compose['services'][service]['image'] != image:
            raise ValueError('Compose and manifest disagree')
    return data


def schema_compatible(left, right):
    # Conservative: an operator must acknowledge any migration-set difference.
    return left.get('migrations') == right.get('migrations')


def version(tag):
    return tuple(map(int, tag.removeprefix('billing-v').split('.')))


def link(root, name, target):
    temporary = root / ('.' + name + '.next')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    temporary.replace(root / name)


def perform(root, bundle, operation, acknowledge_schema=False, backup_confirmed=False):
    root = Path(root).resolve()
    shared = root / 'shared'
    settings = json.loads((shared / 'host.json').read_text())
    registry_host = settings['registry_host']
    incoming = read_manifest(bundle, registry_host)
    bind = str(ipaddress.ip_address(settings['bind_address']))
    api_port = int(settings.get('api_port', 3015))
    web_port = int(settings.get('web_port', 5175))
    if not all(1 <= port <= 65535 for port in [api_port, web_port]) or api_port == web_port:
        raise ValueError('Invalid API/web ports')
    public_url = settings['public_url'].rstrip('/')
    if not re.fullmatch(r'https://[a-zA-Z0-9.-]+(?::[0-9]+)?', public_url):
        raise ValueError('public_url must be an HTTPS origin')
    secret_file = shared / 'production.env'
    if not secret_file.is_file() or secret_file.stat().st_mode & 0o077:
        raise ValueError('shared/production.env must exist with mode 600 or 400')
    if re.search(r'^SECRETS_ENABLED=true\s*$', secret_file.read_text(), re.M):
        raise ValueError('Vault runtime is unsupported by the migration CLI; configure DB_* explicitly')
    if operation == 'migrate' and not backup_confirmed:
        raise ValueError('Explicit backup confirmation is required for migrations')
    environment = {**os.environ, 'BILLING_API_ENV_FILE': str(secret_file),
                   'BILLING_BIND_ADDRESS': bind, 'BILLING_API_PORT': str(api_port),
                   'BILLING_WEB_PORT': str(web_port)}
    release = root / 'releases' / incoming['tag']
    release.parent.mkdir(parents=True, exist_ok=True)
    if release.exists():
        if read_manifest(release, registry_host) != incoming:
            raise ValueError('Refusing to overwrite an existing release')
    else:
        staging = release.with_name('.' + incoming['tag'] + '.incoming')
        if staging.exists():
            raise ValueError('Incomplete previous upload: inspect ' + str(staging))
        shutil.copytree(bundle, staging)
        staging.rename(release)
    current = (root / 'current').resolve() if (root / 'current').exists() else None
    old = read_manifest(current, registry_host) if current else None
    if old:
        if operation == 'deploy' and version(incoming['tag']) < version(old['tag']):
            raise ValueError('Use rollback to deploy an older release')
        if operation == 'rollback' and version(incoming['tag']) >= version(old['tag']):
            raise ValueError('Rollback must select an older release')
        if operation == 'rollback' and not schema_compatible(old, incoming) and not acknowledge_schema:
            raise ValueError('Migration sets differ: review schema compatibility and explicitly acknowledge')
    elif operation == 'rollback':
        raise ValueError('No current release to roll back')

    def compose(directory, *args, capture=False):
        result = subprocess.run(['docker', 'compose', '--env-file', '/dev/null',
            '-p', 'hemia-billing', '-f', str(directory / 'compose.json'), *args],
            env=environment, text=True, capture_output=capture, check=True)
        return result.stdout

    def ready(directory):
        compose(directory, 'run', '--rm', '--no-deps', 'backend', 'node', '-e',
            "const d=require('./dist/data-source').AppDataSource;"
            "(async()=>{try{await d.initialize();if(await d.showMigrations())"
            "throw Error('pending_migrations: run the explicit migration operation first')}"
            "finally{if(d.isInitialized)await d.destroy()}})().catch(()=>{console.error('Billing database preflight failed');process.exit(1)})")

    def start(directory):
        compose(directory, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '120')
        compose(directory, 'exec', '-T', 'backend', 'node', '-e',
            "(async()=>{for(const u of ['http://backend:3015/api/v1','http://frontend:5175']){"
            "const r=await fetch(u,{signal:AbortSignal.timeout(10000)});"
            "if(!r.ok)throw Error('Billing internal probe failed: '+r.status)}})()"
            ".catch(()=>{console.error('Billing internal probe failed');process.exit(1)})")
        for path in ['/', '/api/v1']:
            request = urllib.request.Request(public_url + path, headers={
                'User-Agent': 'Hemia-Billing-Deploy/1.0',
                'Accept': 'text/html' if path == '/' else 'text/plain',
            })
            with urllib.request.urlopen(request, timeout=15) as response:
                if response.status != 200:
                    raise ValueError('Public Billing probe failed')
                # Match the API greeting to avoid mistaking the frontend fallback for API routing.
                if path == '/api/v1' and response.read(128).decode().strip() != 'Hello World!':
                    raise ValueError('Public API route is not served by Billing backend')

    def record(status, **extra):
        with (root / 'history.jsonl').open('a') as history:
            history.write(json.dumps({'time': datetime.now(timezone.utc).isoformat(),
                'operation': operation, 'tag': incoming['tag'], 'commit': incoming['commit'],
                'status': status, **extra}) + '\n')

    compose(release, 'config', '--quiet')
    compose(release, 'pull')
    if operation == 'migrate':
        try:
            compose(release, 'run', '--rm', '--no-deps', 'backend', 'node',
                    'node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/data-source.js')
        except Exception:
            record('migration_failed')
            raise
        record('migrated')
        return
    try:
        ready(release)  # Refuse pending migrations before replacing running containers.
    except Exception:
        record('preflight_failed')
        raise
    try:
        start(release)
    except Exception:
        record('failed')
        if current and schema_compatible(old, incoming):
            try:
                ready(current)
                start(current)
                record('recovered', recovered_tag=old['tag'])
            except Exception:
                record('recovery_failed')
                raise
        else:
            print('Automatic recovery disabled: no prior release or migration sets differ', flush=True)
        raise
    if current and current != release:
        link(root, 'previous', current)
    link(root, 'current', release)
    record('healthy')
    print('Healthy Billing release: ' + incoming['tag'], flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['deploy', 'rollback', 'migrate'])
    parser.add_argument('--root', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--acknowledge-schema', action='store_true')
    parser.add_argument('--backup-confirmed', action='store_true')
    args = parser.parse_args()
    root = Path(args.root)
    if not root.is_absolute() or not root.is_dir():
        raise ValueError('Deployment root must be an existing absolute directory')
    os.umask(0o077)
    with (root / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        perform(root, Path(args.bundle), args.operation, args.acknowledge_schema, args.backup_confirmed)


if __name__ == '__main__':
    main()
