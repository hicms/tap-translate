import { rm } from 'node:fs/promises';
import { artifactPath } from './artifact-paths.mjs';

await rm(artifactPath(), { recursive: true, force: true });
console.log(`Cleaned ${artifactPath()}`);
