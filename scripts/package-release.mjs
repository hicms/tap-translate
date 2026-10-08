import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const root = realpath(dirname(scriptRoot));
const extensionRoot = join(root, 'extension');
const artifactRoot = join(root, 'artifacts', 'extension');
const releaseRoot = join(root, 'artifacts', 'release');

function realpath(path) {
  const result = spawnSync(process.platform === 'win32' ? 'node.exe' : 'node', [
    '-e',
    'const fs=require("node:fs"); process.stdout.write(fs.realpathSync(process.argv[1]));',
    '--',
    path,
  ], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) return path;
  return result.stdout.trim();
}

const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const packageJson = readJson('extension/package.json');
const version = packageJson.version;
const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
const versionPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (process.argv.length > 3 || !versionPattern.test(tag || '') || tag !== `v${version}`) {
  throw new Error(`Release tag must be v${version}. Usage: node scripts/package-release.mjs vX.Y.Z`);
}

function runNpm(args) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, args, {
    cwd: extensionRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

function assertProductionArtifacts() {
  const forbiddenNames = new Set(['dev-settings.json', '.env', '.env.local', 'credentials.json']);
  for (const path of filesUnder(artifactRoot)) {
    if (forbiddenNames.has(path.split(/[\\/]/).pop())) {
      throw new Error(`Forbidden developer file in release artifacts: ${path}`);
    }
    if (path.endsWith('manifest.json')) {
      const manifestText = readFileSync(path, 'utf8');
      if (/wxt:reload-extension|localhost:3000/.test(manifestText)) {
        throw new Error(`Development marker found in release manifest: ${path}`);
      }
    }
  }
}

function packageAsset(browser) {
  const sourceName = `tap-translate-extension-${version}-${browser}.zip`;
  const archiveName = `tap-translate-${browser}-${tag}.zip`;
  const checksumName = `tap-translate-${browser}-${tag}.sha256`;
  const sourcePath = join(artifactRoot, sourceName);
  const archivePath = join(releaseRoot, archiveName);
  const checksumPath = join(releaseRoot, checksumName);
  if (!existsSync(sourcePath) || statSync(sourcePath).size === 0) {
    throw new Error(`Missing or empty WXT archive: ${sourcePath}`);
  }
  copyFileSync(sourcePath, archivePath);
  writeFileSync(checksumPath, `${sha256(archivePath)}  ${archiveName}\n`, 'utf8');
  return { archiveName, archivePath, checksumName, checksumPath };
}

runNpm(['run', 'zip']);
runNpm(['run', 'zip:firefox']);

for (const browser of ['chrome', 'firefox']) {
  const manifest = readJson(`artifacts/extension/${browser === 'chrome' ? 'chrome-mv3' : 'firefox-mv3'}/manifest.json`);
  if (manifest.manifest_version !== 3 || manifest.version !== version) {
    throw new Error(`${browser} manifest version does not match extension/package.json`);
  }
}
assertProductionArtifacts();

rmSync(releaseRoot, { recursive: true, force: true });
mkdirSync(releaseRoot, { recursive: true });
const assets = ['chrome', 'firefox'].map(packageAsset);
for (const asset of assets) {
  console.log(`Release asset: ${asset.archivePath}`);
  console.log(`SHA-256: ${asset.checksumPath}`);
}
