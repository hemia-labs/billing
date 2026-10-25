import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


deploy = load('billing-deploy')



class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shared = self.root / 'shared'
        shared.mkdir()
        env = shared / 'production.env'
        env.write_text('NODE_ENV=production\n')
        env.chmod(0o600)
        (shared / 'host.json').write_text(json.dumps({
            'bind_address': '127.0.0.1', 'api_port': 3015, 'web_port': 5175,
            'public_url': 'https://id.example.test', 'registry_host': 'registry.tail41610c.ts.net'}))
        self.commands = []

    def bundle(self, tag, migrations=None):
        directory = self.root / ('bundle-' + tag)
        directory.mkdir()
        images = {name: f'registry.tail41610c.ts.net/billing/{name}@sha256:' + 'a' * 64
                  for name in ['backend', 'frontend']}
        compose = {'services': {name: {'image': value} for name, value in images.items()}}
        (directory / 'compose.json').write_text(json.dumps(compose))
        (directory / 'billing-deploy.py').write_bytes((ROOT / 'scripts/billing-deploy.py').read_bytes())
        manifest = {'schema': 1, 'tag': tag, 'registry': 'registry.tail41610c.ts.net', 'commit': 'b' * 40, 'images': images,
                    'migrations': migrations or {},
                    'files': {name: hashlib.sha256((directory / name).read_bytes()).hexdigest()
                              for name in ['compose.json', 'billing-deploy.py']}}
        (directory / 'release.json').write_text(json.dumps(manifest))
        return directory

    def command(self, args, **kwargs):
        self.commands.append(args)
        return subprocess.CompletedProcess(args, 0, '')

    def response(self, request, **kwargs):
        import io
        self.assertEqual(request.get_header('User-agent'), 'Hemia-Billing-Deploy/1.0')
        self.assertEqual(request.get_header('Accept'), 'text/plain' if request.full_url.endswith('/api/v1') else 'text/html')
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(kwargs['timeout'], 15)
        body = b'Hello World!' if request.full_url.endswith('/api/v1') else b'<html>Billing</html>'
        class Response(io.BytesIO):
            status = 200
        return Response(body)

    def perform(self, bundle, operation='deploy', **kwargs):
        with patch.object(deploy.subprocess, 'run', side_effect=self.command), \
             patch.object(deploy.urllib.request, 'urlopen', side_effect=self.response):
            deploy.perform(self.root, bundle, operation, **kwargs)

    def test_success_records_current_and_never_runs_migrations(self):
        bundle = self.bundle('billing-v1.0.0')
        self.perform(bundle)
        self.assertEqual((self.root / 'current').resolve().name, 'billing-v1.0.0')
        self.assertFalse(any('migration:run' in c for c in self.commands))
        self.assertTrue(any('showMigrations' in ' '.join(c) for c in self.commands))

    def test_asset_tampering_fails_before_docker(self):
        bundle = self.bundle('billing-v1.0.0')
        (bundle / 'compose.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.perform(bundle)
        self.assertEqual(self.commands, [])

    def test_rollback_requires_schema_ack_and_never_reverts(self):
        self.perform(self.bundle('billing-v1.1.0', {'new.ts': 'c' * 64}))
        old = self.bundle('billing-v1.0.0')
        with self.assertRaisesRegex(ValueError, 'Migration sets differ'):
            self.perform(old, 'rollback')
        self.perform(old, 'rollback', acknowledge_schema=True)
        self.assertEqual((self.root / 'current').resolve().name, 'billing-v1.0.0')
        self.assertEqual((self.root / 'previous').resolve().name, 'billing-v1.1.0')
        self.assertFalse(any('migration:revert' in c for c in self.commands))

    def test_migration_requires_backup_and_does_not_promote(self):
        bundle = self.bundle('billing-v1.0.0')
        with self.assertRaisesRegex(ValueError, 'backup'):
            self.perform(bundle, 'migrate')
        self.perform(bundle, 'migrate', backup_confirmed=True)
        self.assertFalse((self.root / 'current').exists())
        self.assertTrue(any('migration:run' in c for c in self.commands))

    def test_failed_health_recovers_prior_images_and_keeps_pointer(self):
        self.perform(self.bundle('billing-v1.0.0'))
        candidate = self.bundle('billing-v1.0.1')
        original = self.command

        def fail_candidate(args, **kwargs):
            if '/billing-v1.0.1/compose.json' in ' '.join(args) and 'up' in args:
                raise subprocess.CalledProcessError(1, args)
            return original(args, **kwargs)

        with patch.object(deploy.subprocess, 'run', side_effect=fail_candidate), \
             patch.object(deploy.urllib.request, 'urlopen', side_effect=self.response):
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.perform(self.root, candidate, 'deploy')
        self.assertEqual((self.root / 'current').resolve().name, 'billing-v1.0.0')
        self.assertIn('"recovered"', (self.root / 'history.jsonl').read_text())

    def test_failed_health_does_not_recover_across_schema_change(self):
        self.perform(self.bundle('billing-v1.0.0'))
        candidate = self.bundle('billing-v1.1.0', {'new.ts': 'c' * 64})
        self.commands.clear()

        def fail(args, **kwargs):
            if 'up' in args:
                raise subprocess.CalledProcessError(1, args)
            return self.command(args, **kwargs)

        with patch.object(deploy.subprocess, 'run', side_effect=fail):
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.perform(self.root, candidate, 'deploy')
        self.assertFalse(any('/billing-v1.0.0/compose.json' in ' '.join(c) for c in self.commands))

    def test_pending_migrations_do_not_replace_current(self):
        self.perform(self.bundle('billing-v1.0.0'))
        candidate = self.bundle('billing-v1.0.1')
        self.commands.clear()

        def fail_preflight(args, **kwargs):
            if 'showMigrations' in ' '.join(args):
                raise subprocess.CalledProcessError(1, args)
            return self.command(args, **kwargs)

        with patch.object(deploy.subprocess, 'run', side_effect=fail_preflight):
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.perform(self.root, candidate, 'deploy')
        self.assertFalse(any('up' in c for c in self.commands))
        self.assertEqual((self.root / 'current').resolve().name, 'billing-v1.0.0')

    def test_untrusted_registry_is_rejected_before_docker(self):
        bundle = self.bundle('billing-v1.0.0')
        manifest = json.loads((bundle / 'release.json').read_text())
        manifest['registry'] = 'attacker.example.test'
        (bundle / 'release.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'unexpected registry'):
            self.perform(bundle)
        self.assertEqual(self.commands, [])

    def test_environment_permissions_fail_before_docker(self):
        bundle = self.bundle('billing-v1.0.0')
        (self.root / 'shared/production.env').chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'mode 600'):
            self.perform(bundle)
        self.assertEqual(self.commands, [])

    def test_vault_cli_is_rejected_before_docker(self):
        bundle = self.bundle('billing-v1.0.0')
        (self.root / 'shared/production.env').write_text('SECRETS_ENABLED=true\n')
        with self.assertRaisesRegex(ValueError, 'Vault'):
            self.perform(bundle)
        self.assertEqual(self.commands, [])

    def test_environment_stays_external_and_pull_precedes_start(self):
        bundle = self.bundle('billing-v1.0.0')
        environments = []
        def capture(args, **kwargs):
            environments.append(kwargs['env'])
            return self.command(args, **kwargs)
        with patch.object(deploy.subprocess, 'run', side_effect=capture), \
             patch.object(deploy.urllib.request, 'urlopen', side_effect=self.response):
            deploy.perform(self.root, bundle, 'deploy')
        self.assertEqual(environments[0]['BILLING_API_ENV_FILE'], str((self.root / 'shared/production.env').resolve()))
        self.assertEqual(environments[0]['BILLING_API_PORT'], '3015')
        self.assertEqual(environments[0]['BILLING_WEB_PORT'], '5175')
        self.assertLess(next(i for i,c in enumerate(self.commands) if 'pull' in c),
                        next(i for i,c in enumerate(self.commands) if 'up' in c))
        self.assertTrue(any('--no-build' in c and '--wait' in c for c in self.commands))
        self.assertFalse((self.root / 'current/production.env').exists())

    def test_public_frontend_fallback_cannot_masquerade_as_api(self):
        import io
        bundle = self.bundle('billing-v1.0.0')
        class Response(io.BytesIO):
            status = 200
        with patch.object(deploy.subprocess, 'run', side_effect=self.command), \
             patch.object(deploy.urllib.request, 'urlopen', side_effect=lambda *a,**k: Response(b'<html>frontend fallback</html>')):
            with self.assertRaisesRegex(ValueError, 'Public API route'):
                deploy.perform(self.root, bundle, 'deploy')
        self.assertFalse((self.root / 'current').exists())


if __name__ == '__main__':
    unittest.main()
