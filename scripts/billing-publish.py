"""Resume a Billing publication without replacing an existing image or release asset."""
import importlib.util
import json
import os
import platform
from pathlib import Path
import re
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location('billing_release', Path(__file__).with_name('billing-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def run(args, missing=()):
    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode:
        if any(value in result.stderr.lower() for value in missing):
            return None
        raise RuntimeError(f'{args[0]} {args[1]} failed: {result.stderr.strip()}')
    return result.stdout


def api(path):
    value = run(['gh', 'api', path], missing=('http 404',))
    return json.loads(value) if value is not None else None


def find_release(path, tag):
    existing = api(f'{path}/releases/tags/{tag}')
    if existing is not None:
        return existing
    # A draft may not be visible through the published-release tag endpoint.
    page = 1
    while True:
        releases = api(f'{path}/releases?per_page=100&page={page}')
        if not isinstance(releases, list):
            raise ValueError('Expected an authenticated release listing')
        matches = [item for item in releases if item['tag_name'] == tag]
        if matches:
            return matches[0]
        if len(releases) < 100:
            return None
        page += 1


def publish(tag, directory):
    if not release.TAG.fullmatch(tag):
        raise ValueError('Expected billing-vMAJOR.MINOR.PATCH')
    commit = run(['git', 'rev-parse', 'HEAD']).strip()
    if not re.fullmatch('[a-f0-9]{40}', commit) or commit != os.environ['GITHUB_SHA']:
        raise ValueError('Checkout differs from the requested commit')
    registry = os.environ['REGISTRY_HOST']
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', registry):
        raise ValueError('Invalid registry hostname')
    repository = os.environ['GITHUB_REPOSITORY']
    path = f'repos/{repository}'
    existing = find_release(path, tag)
    ref = api(f'{path}/git/ref/tags/{tag}')
    if ref and (ref['object']['type'] != 'commit' or ref['object']['sha'] != commit):
        raise ValueError('Existing release tag points to another commit')
    if existing and (existing['tag_name'] != tag or existing['prerelease'] or
                     existing['name'] != f'Billing {tag.removeprefix("billing-v")}'):
        raise ValueError('Unexpected existing release metadata')
    if existing and existing['draft'] and existing.get('target_commitish') != commit:
        raise ValueError('Existing draft belongs to another commit')
    if existing and not existing['draft']:
        if not ref or not existing.get('immutable'):
            raise ValueError('Expected an immutable published release at this commit')
        print(f'{tag} is already published; no changes made')
        return
    images = {}
    for service in ['backend', 'frontend']:
        image = f'{registry}/billing/{service}:{tag}'
        manifest = run(['docker', 'manifest', 'inspect', '--verbose', image], missing=('manifest unknown', 'no such manifest'))
        if manifest is None:
            local = f'hemia-billing-{service}:local'
            info = json.loads(run(['docker', 'image', 'inspect', local]))[0]
            if info.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != commit:
                raise ValueError(f'{service} local image belongs to another commit')
            run(['docker', 'tag', local, image])
            run(['docker', 'push', image])
            manifest = run(['docker', 'manifest', 'inspect', '--verbose', image])
        descriptors = json.loads(manifest)
        if isinstance(descriptors, list):
            architecture = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine(), platform.machine())
            matches = [entry['Descriptor'] for entry in descriptors
                       if entry['Descriptor'].get('platform', {}).get('os') == 'linux' and
                       entry['Descriptor'].get('platform', {}).get('architecture') == architecture]
            if len(matches) != 1:
                raise ValueError('Expected exactly one image for the release runner platform')
            descriptor = matches[0]
        else:
            descriptor = descriptors['Descriptor']
        digest = descriptor['digest']
        if not re.fullmatch('sha256:[a-f0-9]{64}', digest):
            raise ValueError('Invalid remote image digest')
        pinned = f'{registry}/billing/{service}@{digest}'
        images[service] = pinned
        run(['docker', 'pull', pinned])
        run(['docker', 'tag', pinned, image])
        info = json.loads(run(['docker', 'image', 'inspect', image]))[0]
        if info.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != commit:
            raise ValueError(f'{service} published image belongs to another commit')
        if pinned not in info.get('RepoDigests', []):
            raise ValueError(f'{service} published image has no registry digest')
    release.create(tag, directory, images=images)
    manifest = release.validate(directory, tag)
    if manifest['commit'] != commit:
        raise ValueError('Release assets belong to another commit')
    if existing is None:
        notes = run(['node', 'scripts/billing-version.mjs', 'notes'])
        existing = json.loads(run([
            'gh', 'api', '--method', 'POST', f'{path}/releases',
            '-f', f'tag_name={tag}', '-f', f'target_commitish={commit}',
            '-f', f'name=Billing {tag.removeprefix("billing-v")}',
            '-f', f'body={notes}', '-F', 'draft=true',
        ]))
        if existing['tag_name'] != tag or not existing['draft'] or existing['target_commitish'] != commit:
            raise ValueError('Created draft differs from the requested release')
    assets = {asset['name']: asset for asset in existing['assets']}
    for name in ['release.json', 'compose.json', 'billing-deploy.py']:
        if name in assets:
            with tempfile.TemporaryDirectory() as temporary:
                run(['gh', 'release', 'download', tag, '--pattern', name, '--dir', temporary])
                if (Path(temporary) / name).read_bytes() != (Path(directory) / name).read_bytes():
                    raise ValueError(f'Existing release asset differs: {name}')
        else:
            run(['gh', 'release', 'upload', tag, str(Path(directory) / name)])
    run(['gh', 'release', 'edit', tag, '--draft=false'])
    published = api(f'{path}/releases/{existing["id"]}')
    if published['draft'] or not published.get('immutable'):
        raise ValueError('Enable release immutability before publishing Billing releases')
    print(f'Release ready: {tag}')


if __name__ == '__main__':
    publish(*sys.argv[1:])
