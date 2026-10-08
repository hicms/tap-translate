import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const releaseTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const escapeMarkdown = text => text.replace(/[\\`*_[\]<>]/g, '\\$&');

function isOlder(candidate, target) {
  const left = candidate.slice(1).split('.').map(Number);
  const right = target.slice(1).split('.').map(Number);
  const differing = left.findIndex((part, index) => part !== right[index]);
  return differing !== -1 && left[differing] < right[differing];
}

function categoryFor(subject) {
  if (/^(feat(?:\([^)]*\))?!?:|add\b|新增|添加|支持)/i.test(subject)) return 'Features';
  if (/^(fix(?:\([^)]*\))?!?:|fix\b|修复)/i.test(subject)) return 'Fixes';
  if (/^(?:perf|refactor)(?:\([^)]*\))?!?:|^(?:improve|optimize|speed up|simplify|replace)\b|^(?:优化|改进)/i.test(subject)) return 'Improvements';
  if (/^(?:build|ci|chore|docs|test|style)(?:\([^)]*\))?!?:/i.test(subject)) return 'Build & Maintenance';
  return 'Other Changes';
}

function repositoryUrl() {
  if (process.env.GITHUB_REPOSITORY) {
    return `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}`;
  }
  const remote = git('config', '--get', 'remote.origin.url').trim();
  const match = remote.match(/^(?:https?:\/\/|git@)([^/:]+)[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Cannot derive an HTTPS repository URL from origin: ${remote}`);
  return `https://${match[1]}/${match[2]}`;
}

function generate() {
  const [tag, output] = process.argv.slice(2);
  if (process.argv.length !== 4 || !releaseTag.test(tag)) {
    throw new Error('Usage: node scripts/generate-release-notes.mjs vX.Y.Z <output.md>');
  }
  if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
    throw new Error('Release notes require complete history. Fetch all history and tags first.');
  }
  git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);

  const previous = git('tag', '--merged', `refs/tags/${tag}`, '--sort=-version:refname')
    .trim()
    .split('\n')
    .find(candidate => releaseTag.test(candidate) && isOlder(candidate, tag));
  const range = previous ? `refs/tags/${previous}..refs/tags/${tag}` : `refs/tags/${tag}`;
  const fields = git('log', '--reverse', '--no-merges', '-z', '--format=%H%x00%s%x00%b', range, '--').split('\0');
  const groups = new Map(['Features', 'Fixes', 'Improvements', 'Build & Maintenance', 'Other Changes'].map(name => [name, []]));
  let count = 0;
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [hash, subject, body] = fields.slice(index, index + 3);
    if (/^Release v\d+\.\d+\.\d+$/.test(subject) && !body.trim()) continue;
    groups.get(categoryFor(subject)).push({ hash, subject, body: body.trim() });
    count++;
  }

  const repo = repositoryUrl().replace(/\.git$/, '').replace(/\/$/, '');
  const date = git('show', '-s', '--format=%cs', `refs/tags/${tag}^{commit}`).trim();
  const lines = [
    "## What's Changed",
    '',
    `${date} · ${previous ? `${previous} → ${tag}` : `${tag} · Initial release`} · ${count} ${count === 1 ? 'commit' : 'commits'}`,
    '',
  ];
  for (const [name, commits] of groups) {
    if (!commits.length) continue;
    lines.push(`### ${name}`, '');
    for (const { hash, subject, body } of commits) {
      lines.push(`- ${escapeMarkdown(subject)} ([${hash.slice(0, 7)}](${repo}/commit/${hash}))`);
      if (body) lines.push('', ...body.split('\n').map(line => `  > ${line}`), '');
    }
    lines.push('');
  }
  if (!count) lines.push('No additional changes beyond the version update.', '');
  lines.push(previous ? `[Full Changelog](${repo}/compare/${previous}...${tag})` : `[Full Commit History](${repo}/commits/${tag})`, '');
  const downloads = `${repo}/releases/download/${tag}`;
  lines.push(
    '## Downloads',
    '',
    `[Chrome ZIP](<${downloads}/tap-translate-chrome-${tag}.zip>) · [Chrome SHA-256](<${downloads}/tap-translate-chrome-${tag}.sha256>)`,
    `[Firefox ZIP](<${downloads}/tap-translate-firefox-${tag}.zip>) · [Firefox SHA-256](<${downloads}/tap-translate-firefox-${tag}.sha256>)`,
    '',
    'For Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, or extract the ZIP first for a packaged release.',
    '',
  );
  writeFileSync(output, lines.join('\n'), 'utf8');
}

try {
  generate();
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
}
