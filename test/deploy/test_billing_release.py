import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('billing_release', ROOT / 'scripts/billing-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / 'release'
        self.commands = []

    def command(self, args, **kwargs):
        self.commands.append((args, kwargs))
        if args[:2] == ['git', 'rev-parse']:
            return 'b' * 40
        if args[:2] == ['docker', 'compose']:
            self.assertIn('--no-env-resolution', args)
            self.assertEqual(kwargs['env']['BILLING_API_ENV_FILE'], '/dev/null')
            return json.dumps({'services': {name: {'image': 'local', 'build': {'context': '.'}}
                                           for name in ['backend', 'frontend']}})
        if args[:3] == ['docker', 'image', 'inspect']:
            image = args[3].split(':billing-v', 1)[0]
            return json.dumps([{'RepoDigests': [image + '@sha256:' + 'a' * 64]}])
        raise AssertionError(args)

    def create(self):
        with patch.object(release.subprocess, 'check_output', side_effect=self.command), \
             patch.dict(os.environ, {'REGISTRY_HOST': release.DEFAULT_REGISTRY,
                                     'BILLING_API_ENV_FILE': '/sensitive/production.env'}):
            release.create('billing-v1.0.0', self.output)
        return release.validate(self.output, 'billing-v1.0.0')

    def test_create_pins_both_images_and_preserves_server_only_env(self):
        manifest = self.create()
        self.assertEqual(set(manifest['images']), {'backend', 'frontend'})
        config = json.loads((self.output / 'compose.json').read_text())
        for service in ['backend', 'frontend']:
            self.assertNotIn('build', config['services'][service])
            self.assertEqual(config['services'][service]['image'],
                             release.DEFAULT_REGISTRY + '/billing/' + service + '@sha256:' + 'a' * 64)
        self.assertEqual(config['services']['backend']['env_file'],
                         [{'path': '${BILLING_API_ENV_FILE:?Set the server environment file}', 'format': 'raw'}])
        self.assertNotIn('/sensitive/', (self.output / 'compose.json').read_text())
        self.assertEqual(set(p.name for p in self.output.iterdir()),
                         {'release.json', 'compose.json', 'billing-deploy.py'})
        self.assertTrue(manifest['migrations'])

    def rewrite(self, update):
        p = self.output / 'release.json'
        manifest = json.loads(p.read_text())
        update(manifest)
        p.write_text(json.dumps(manifest))

    def test_mutable_or_other_service_image_is_rejected(self):
        self.create()
        self.rewrite(lambda m: m['images'].update(backend=release.DEFAULT_REGISTRY + '/billing/backend:latest'))
        with self.assertRaisesRegex(ValueError, 'digest'):
            release.validate(self.output)
        self.rewrite(lambda m: m['images'].update(backend=release.DEFAULT_REGISTRY + '/billing/frontend@sha256:' + 'a' * 64))
        with self.assertRaisesRegex(ValueError, 'digest'):
            release.validate(self.output)

    def test_registry_mismatch_and_changed_assets_are_rejected(self):
        self.create()
        with self.assertRaisesRegex(ValueError, 'unexpected registry'):
            release.validate(self.output, registry_host='attacker.example.test')
        (self.output / 'compose.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            release.validate(self.output)

    def test_wrong_tag_and_invalid_migration_are_rejected(self):
        self.create()
        with self.assertRaisesRegex(ValueError, 'requested tag'):
            release.validate(self.output, 'billing-v1.0.1')
        self.rewrite(lambda m: m.update(migrations={'../escape.ts': 'a' * 64}))
        with self.assertRaisesRegex(ValueError, 'migration'):
            release.validate(self.output)

    def test_explicit_selected_digests_are_preserved_and_must_exist(self):
        selected = {service: release.DEFAULT_REGISTRY + '/billing/' + service + '@sha256:' + 'c' * 64
                    for service in ['backend', 'frontend']}

        def command(args, **kwargs):
            value = self.command(args, **kwargs)
            if args[:3] == ['docker', 'image', 'inspect']:
                infos = json.loads(value)
                service = args[3].split('/')[-1].split(':')[0]
                infos[0]['RepoDigests'].append(selected[service])
                return json.dumps(infos)
            return value

        with patch.object(release.subprocess, 'check_output', side_effect=command):
            release.create('billing-v1.0.0', self.output, images=selected)
        self.assertEqual(release.validate(self.output)['images'], selected)
        with patch.object(release.subprocess, 'check_output', side_effect=self.command):
            with self.assertRaisesRegex(ValueError, 'Selected image digest'):
                release.create('billing-v1.0.0', self.output, images=selected)

    def test_invalid_tag_is_rejected_before_docker(self):
        for tag in ['billing-v01.0.0', 'identity-v1.0.0', 'billing-v1.0.0;id', 'billing-v1.0.0\n']:
            with self.assertRaisesRegex(ValueError, 'billing-v'):
                release.create(tag, self.output)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
