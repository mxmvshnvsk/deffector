// What the published packages contain, checked against what their manifests promise.
// Run after `npm run build`: it reads the built output rather than building it.
//
//   npm run check:artifacts
//
// Three things go wrong silently when a package is assembled, and none of them
// fail a build, a type check or a test:
//
//   1. `exports`, `main`, `types` or `bin` names a file that `files` leaves out
//      of the tarball. Everything passes here and breaks for whoever installs it.
//   2. A published file imports a relative path that is not published with it.
//      Same failure, one level deeper.
//   3. A `production` entry stops being a no-op. The agent's production exports
//      exist so that an app's production build ships none of the devtool; if an
//      import creeps from one of those entries into a live module, a user's
//      bundle grows by the whole agent and nothing says so. `solidNoopProvider`
//      carries the rule as a comment — "production builds must not import the
//      agent" — and this is that comment made checkable.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Published packages, by their directory under `packages/`. */
const PACKAGES = ['agent', 'standalone'];

/**
 * An `exports` condition the monorepo resolves for itself: the demos read the
 * agent from its TypeScript sources, which are deliberately not published.
 */
const UNPUBLISHED_CONDITION = '@deffector/source';

/**
 * Bytes a `production` entry may reach, following its relative imports. The
 * no-op entries are a few hundred bytes each and the agent is around 200 KB, so
 * anything over this means a live module got pulled in or inlined.
 */
const PRODUCTION_BUDGET = 8 * 1024;

/** Extensions tried for an import that does not name one. */
const EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '/index.js', '/index.mjs'];

/**
 * A declaration file imports `./x.js` and means `./x.d.ts`: TypeScript resolves
 * the request as the runtime would and then looks for the types beside it.
 */
const asDeclaration = (request) => `${request.replace(/\.js$/, '')}.d.ts`;

const TEXT = /\.(js|mjs|cjs|ts|tsx)$/;

const problems = [];
const report = (pkg, problem) => problems.push(`${pkg}: ${problem}`);

/** The files `npm pack` would put in the tarball, as paths relative to the package. */
function tarballOf(directory) {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [packed] = JSON.parse(output);
  return { files: new Set(packed.files.map((file) => file.path)), size: packed.unpackedSize };
}

/** Every path a manifest points at, as `{ where, target }`, skipping unpublished conditions. */
function manifestTargets(manifest) {
  const targets = [];
  for (const field of ['main', 'module', 'types']) {
    if (typeof manifest[field] === 'string')
      targets.push({ where: field, target: manifest[field] });
  }
  for (const [name, target] of Object.entries(manifest.bin ?? {})) {
    targets.push({ where: `bin.${name}`, target });
  }
  const walk = (node, where) => {
    if (typeof node === 'string') {
      if (!where.includes(UNPUBLISHED_CONDITION)) targets.push({ where, target: node });
      return;
    }
    for (const [key, value] of Object.entries(node ?? {})) walk(value, `${where} ${key}`.trim());
  };
  walk(manifest.exports, 'exports');
  return targets.filter(({ target }) => target.startsWith('./'));
}

const asPath = (target) => target.replace(/^\.\//, '');

/** The file a relative import resolves to, relative to the package, or null. */
function resolveImport(directory, fromFile, request) {
  const from = resolve(directory, dirname(fromFile));
  const candidates = fromFile.endsWith('.d.ts')
    ? [resolve(from, asDeclaration(request))]
    : EXTENSIONS.map((extension) => resolve(from, request) + extension);
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(directory, candidate);
    }
  }
  return null;
}

const RELATIVE_IMPORT = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]*)['"]/g;

/** Relative imports written in a file. */
function importsOf(directory, file) {
  const source = readFileSync(join(directory, file), 'utf8');
  return [...source.matchAll(RELATIVE_IMPORT)].map((match) => match[1]);
}

/** Every published file reachable from `entry` through relative imports, `entry` included. */
function closureOf(directory, entry, tarball) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !TEXT.test(file)) {
      seen.add(file);
      continue;
    }
    seen.add(file);
    for (const request of importsOf(directory, file)) {
      const target = resolveImport(directory, file, request);
      if (target && tarball.has(target)) queue.push(target);
    }
  }
  return [...seen];
}

for (const name of PACKAGES) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const { files: tarball, size } = tarballOf(directory);
  console.log(`\n${manifest.name}  ${tarball.size} files, ${(size / 1024).toFixed(0)} KB unpacked`);

  // 1. everything the manifest names is published
  const targets = manifestTargets(manifest);
  for (const { where, target } of targets) {
    if (!tarball.has(asPath(target))) {
      report(manifest.name, `${where} points at ${target}, which the tarball does not contain`);
    }
  }
  console.log(`  manifest targets published: ${targets.length} checked`);

  // 2. every relative import inside a published file is published too
  let imports = 0;
  for (const file of tarball) {
    if (!TEXT.test(file)) continue;
    for (const request of importsOf(directory, file)) {
      imports += 1;
      const target = resolveImport(directory, file, request);
      if (!target) report(manifest.name, `${file} imports ${request}, which does not exist`);
      else if (!tarball.has(target)) {
        report(manifest.name, `${file} imports ${request} (${target}), which is not published`);
      }
    }
  }
  console.log(`  relative imports resolve and are published: ${imports} checked`);

  // 3. production entries stay no-ops
  const production = targets.filter(({ where }) => where.includes('production'));
  for (const { where, target } of production) {
    const entry = asPath(target);
    if (!tarball.has(entry)) continue; // already reported above
    const closure = closureOf(directory, entry, tarball);
    const bytes = closure.reduce((total, file) => total + statSync(join(directory, file)).size, 0);
    const label = where.replace('exports', '').replace('production', '').trim() || '.';
    if (bytes > PRODUCTION_BUDGET) {
      report(
        manifest.name,
        `the production entry for ${label} reaches ${bytes} B through ${closure.length} files, over the ${PRODUCTION_BUDGET} B budget — a live module is being pulled in`,
      );
    }
    console.log(`  production ${label.padEnd(14)} ${String(bytes).padStart(6)} B`);
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('\nartifacts look right');
