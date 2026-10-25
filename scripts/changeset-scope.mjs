import assert from 'node:assert/strict';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function changesetTargets(source) {
  const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
  return [...header.matchAll(/^\s*["']?([^"'\s:]+)["']?\s*:\s*(patch|minor|major)\s*$/gm)].map(m => m[1]);
}

export function withChangesetScope(scope, version) {
  assert(['billing', 'payments'].includes(scope), 'Unknown release scope');
  const selected = scope === 'billing' ? ['api', 'web'] : ['@hemia/payments'];
  const directory = join(root, '.changeset');
  const configFile = join(directory, 'config.json');
  const original = readFileSync(configFile);
  const config = JSON.parse(original);
  const hidden = [];
  for (const name of readdirSync(directory).filter(n => n.endsWith('.md') && n !== 'README.md')) {
    const path = join(directory, name), contents = readFileSync(path);
    const targets = changesetTargets(contents.toString());
    assert(targets.length || /^---\r?\n\s*---(?:\r?\n|$)/.test(contents.toString()), `Invalid changeset: ${name}`);
    const matches = targets.filter(target => selected.includes(target));
    assert(!matches.length || matches.length === targets.length, `Split cross-scope changeset: ${name}`);
    if (!matches.length) hidden.push({ path, contents });
  }
  // Each product consumes only its notes; restore the shared configuration and other notes even on failure.
  try {
    for (const note of hidden) unlinkSync(note.path);
    config.fixed = scope === 'billing' ? [['api', 'web']] : [];
    config.privatePackages = { ...config.privatePackages, version: scope === 'billing', tag: false };
    writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
    return version();
  } finally {
    writeFileSync(configFile, original);
    for (const note of hidden) writeFileSync(note.path, note.contents);
  }
}
