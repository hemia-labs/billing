import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('billing_publish', ROOT / 'scripts/billing-publish.py')
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)
SHA = 'b' * 40
REGISTRY = 'registry.example.test'
TAG = 'billing-v1.0.1'


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'release'
        self.remote = {}
        self.local = {f'hemia-billing-{service}:local': SHA for service in ['backend', 'frontend']}
        self.assets = {}
        self.existing = None
        self.ref = None
        self.mutations = []
        self.fail_push = None
        self.fail_upload = None
        self.fail_finalize = False
        self.unauthorized = False
        self.multi_platform = False

    def command(self, args, missing=()):
        if args == ['git', 'rev-parse', 'HEAD']:
            return SHA
        if args[:2] == ['gh', 'api']:
            if '/git/ref/' in args[2]:
                return json.dumps(self.ref) if self.ref else None
            if self.existing is None:
                return None
            return json.dumps({**self.existing, 'assets': [{'name': name} for name in self.assets]})
        if args[:3] == ['docker', 'manifest', 'inspect']:
            if self.unauthorized:
                raise RuntimeError('unauthorized')
            service = args[-1].split('/')[-1].split(':')[0]
            if service not in self.remote:
                return None
            descriptor = {'digest': 'sha256:' + service[0] * 64}
            if self.multi_platform:
                descriptor['platform'] = {'os': 'linux', 'architecture': 'amd64'}
                return json.dumps([{'Descriptor': descriptor}, {'Descriptor': {
                    'digest': 'sha256:' + 'a' * 64, 'platform': {'os': 'unknown', 'architecture': 'unknown'}}}])
            return json.dumps({'Descriptor': descriptor})
        if args[:2] == ['docker', 'pull']:
            service = args[2].split('/')[-1].split('@')[0]
            self.local[args[2]] = self.remote[service]
            return ''
        if args[:2] == ['docker', 'tag']:
            self.local[args[3]] = self.local[args[2]]
            return ''
        if args[:2] == ['docker', 'push']:
            service = args[2].split('/')[-1].split(':')[0]
            if service == self.fail_push:
                raise RuntimeError('upload disconnected')
            self.remote[service] = self.local[args[2]]
            self.mutations.append(('push', service))
            return ''
        if args[:3] == ['docker', 'image', 'inspect']:
            image = args[3]
            service = image.split('/')[-1].split(':')[0]
            return json.dumps([{'Config': {'Labels': {'org.opencontainers.image.revision': self.local[image]}},
                                'RepoDigests': [f'{REGISTRY}/billing/{service}@sha256:' + service[0] * 64]}])
        if args[:2] == ['node', 'scripts/billing-version.mjs']:
            return 'Reviewed notes'
        if args[:3] == ['gh', 'release', 'create']:
            self.existing = dict(tag_name=TAG, name='Billing 1.0.1', draft=True, prerelease=False, target_commitish=SHA)
            self.mutations.append(('create', TAG))
            return ''
        if args[:3] == ['gh', 'release', 'upload']:
            path = Path(args[4])
            if path.name == self.fail_upload:
                raise RuntimeError('upload disconnected')
            self.assets[path.name] = path.read_bytes()
            self.mutations.append(('upload', path.name))
            return ''
        if args[:3] == ['gh', 'release', 'download']:
            (Path(args[7]) / args[5]).write_bytes(self.assets[args[5]])
            return ''
        if args[:3] == ['gh', 'release', 'edit']:
            if self.fail_finalize:
                raise RuntimeError('finalize disconnected')
            self.existing.update(draft=False, immutable=True)
            self.ref = {'object': {'type': 'commit', 'sha': SHA}}
            self.mutations.append(('publish', TAG))
            return ''
        raise AssertionError(args)

    def create(self, tag, directory, images):
        self.assertEqual(set(images), {"backend", "frontend"})
        directory = Path(directory)
        directory.mkdir(exist_ok=True)
        for name in ['release.json', 'compose.json', 'billing-deploy.py']:
            (directory / name).write_bytes(name.encode())

    def publish(self):
        with patch.object(publish, 'run', side_effect=self.command), \
             patch.object(publish.release, 'create', side_effect=self.create), \
             patch.object(publish.release, 'validate', return_value={'commit': SHA}), \
             patch.dict(os.environ, GITHUB_SHA=SHA, GITHUB_REPOSITORY='hemia-labs/billing', REGISTRY_HOST=REGISTRY):
            publish.publish(TAG, self.directory)

    def test_resumes_after_backend_push_without_overwriting_it(self):
        self.fail_push = 'frontend'
        with self.assertRaisesRegex(RuntimeError, 'disconnected'):
            self.publish()
        self.assertEqual(self.remote, {'backend': SHA})
        self.fail_push = None
        self.publish()
        self.assertEqual(self.mutations.count(('push', 'backend')), 1)
        self.assertEqual(self.mutations.count(('push', 'frontend')), 1)
        self.assertTrue(self.existing['immutable'])

    def test_resumes_draft_missing_one_asset_without_replacing_assets(self):
        self.fail_upload = 'compose.json'
        with self.assertRaisesRegex(RuntimeError, 'disconnected'):
            self.publish()
        self.assertEqual(set(self.assets), {'release.json'})
        self.fail_upload = None
        self.publish()
        self.assertEqual(self.mutations.count(('create', TAG)), 1)
        self.assertEqual(self.mutations.count(('upload', 'release.json')), 1)
        self.assertEqual(len(self.assets), 3)
        before = list(self.mutations)
        self.publish()
        self.assertEqual(self.mutations, before)

    def test_draft_at_other_commit_blocks_mutations_even_without_a_tag(self):
        self.existing = dict(tag_name=TAG, name='Billing 1.0.1', draft=True,
                             prerelease=False, target_commitish='c' * 40)
        with self.assertRaisesRegex(ValueError, 'draft belongs to another commit'):
            self.publish()
        self.assertFalse(self.mutations)

    def test_resumes_after_all_assets_uploaded_before_finalizing(self):
        self.fail_finalize = True
        with self.assertRaisesRegex(RuntimeError, 'finalize disconnected'):
            self.publish()
        self.assertEqual(len(self.assets), 3)
        self.fail_finalize = False
        self.publish()
        self.assertEqual(sum(kind == 'upload' for kind, _ in self.mutations), 3)
        self.assertFalse(self.existing['draft'])

    def test_manifest_index_selects_runner_image_and_ignores_attestations(self):
        self.multi_platform = True
        with patch.object(publish.platform, 'machine', return_value='x86_64'):
            self.publish()
        self.assertTrue(self.existing['immutable'])
        with patch.object(publish.platform, 'machine', return_value='arm64'):
            self.existing = None
            with self.assertRaisesRegex(ValueError, 'runner platform'):
                self.publish()

    def test_mismatched_existing_image_fails_without_pushing(self):
        self.remote['backend'] = 'c' * 40
        with self.assertRaisesRegex(ValueError, 'another commit'):
            self.publish()
        self.assertFalse(self.mutations)

    def test_mismatched_draft_asset_is_never_overwritten(self):
        self.fail_upload = 'compose.json'
        with self.assertRaises(RuntimeError):
            self.publish()
        self.assets['release.json'] = b'tampered'
        self.fail_upload = None
        with self.assertRaisesRegex(ValueError, 'asset differs'):
            self.publish()
        self.assertEqual(self.assets['release.json'], b'tampered')
        self.assertTrue(self.existing['draft'])

    def test_other_commit_tag_blocks_all_mutations(self):
        self.ref = {'object': {'type': 'commit', 'sha': 'c' * 40}}
        with self.assertRaisesRegex(ValueError, 'another commit'):
            self.publish()
        self.assertFalse(self.mutations)

    def test_registry_errors_are_not_treated_as_missing_images(self):
        self.unauthorized = True
        with self.assertRaisesRegex(RuntimeError, 'unauthorized'):
            self.publish()
        self.assertFalse(self.mutations)

    def test_cli_only_accepts_explicit_missing_errors(self):
        for stderr, absent in [('manifest unknown', True), ('unauthorized', False), ('network timeout', False)]:
            result = publish.subprocess.CompletedProcess([], 1, '', stderr)
            with patch.object(publish.subprocess, 'run', return_value=result):
                if absent:
                    self.assertIsNone(publish.run(['docker', 'manifest'], missing=('manifest unknown',)))
                else:
                    with self.assertRaises(RuntimeError):
                        publish.run(['docker', 'manifest'], missing=('manifest unknown',))


if __name__ == '__main__':
    unittest.main()
