import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2] || process.cwd();
const sourceOnly = process.argv.includes('--source-only');
const version = JSON.parse(
  await readFile(join(root, 'creativesignal/container/version.json'), 'utf8')
);

if (version.schema !== 'creator-signal.strapi-image/v1') {
  throw new Error('Creator Signal Strapi image schema is invalid');
}

const packagePaths = [
  'packages/core/admin/package.json',
  'packages/core/strapi/package.json',
  'packages/core/types/package.json',
  'creativesignal/container/package.json',
];
const packages = await Promise.all(
  packagePaths.map(async (path) => JSON.parse(await readFile(join(root, path), 'utf8')))
);
const expectedDistributionVersion = `${version.upstreamVersion}-cs.${version.distributionRevision}`;
if (packages.slice(0, 3).some((pkg) => pkg.version !== version.upstreamVersion)) {
  throw new Error('Creator Signal image version does not match the fork package versions');
}
if (packages[3].version !== expectedDistributionVersion) {
  throw new Error('Creator Signal container package version is inconsistent');
}

const customSource = join(root, 'packages/core/admin/server/src/creativesignal');
const callbackSource = await readFile(join(customSource, 'admin-oidc/config.ts'), 'utf8');
if (!callbackSource.includes('/admin/creativesignal/oidc/callback')) {
  throw new Error('Creator Signal OIDC callback contract is missing');
}

const listFiles = async (directory) => {
  const files = [];
  const walk = async (currentDirectory) => {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const path = join(currentDirectory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  };
  await walk(directory);
  return files;
};

const distributionFiles = await listFiles(join(root, 'creativesignal'));
if (distributionFiles.some((path) => path.split('/').includes('ee'))) {
  throw new Error('Creator Signal distribution code must not be placed under an ee directory');
}

if (!sourceOnly) {
  const builtAdminRoot = join(root, 'packages/core/admin/dist');
  const builtFiles = await Promise.all(
    (await listFiles(builtAdminRoot))
      .filter((path) => /\.(?:js|mjs|cjs)$/.test(path))
      .map((path) => readFile(path, 'utf8'))
  );
  if (!builtFiles.some((content) => content.includes('/admin/creativesignal/oidc/callback'))) {
    throw new Error('Built @strapi/admin package does not contain Creator Signal OIDC');
  }
}

console.log(`Creator Signal Strapi ${expectedDistributionVersion} distribution contract is valid`);
