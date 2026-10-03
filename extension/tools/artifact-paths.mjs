import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Absolute, working-directory-independent paths for configurable tool outputs. */
export function artifactPath(...segments) {
  return path.join(repositoryRoot, 'artifacts', ...segments);
}

// Shell scripts need repository-relative paths with portable separators.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(path.relative(repositoryRoot, artifactPath(...process.argv.slice(2))).split(path.sep).join('/'));
}
