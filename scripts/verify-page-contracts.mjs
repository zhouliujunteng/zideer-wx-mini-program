import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
const routes = [
  ...(app.pages || []),
  ...((app.subpackages || []).flatMap((pkg) =>
    (pkg.pages || []).map((page) => `${pkg.root}/${page}`),
  )),
];
const requiredExtensions = ['.js', '.json', '.wxml', '.wxss'];
const eventPattern = /(?:bind|catch)(?:tap|input|change|blur|focus|confirm|submit|longpress|touchstart|touchend|scrolltolower)="([A-Za-z_$][\w$]*)"/g;
const failures = [];
const visited = new Set();

// Registered page modules are CommonJS. Loading them with inert framework
// constructors catches missing relative imports before DevTools loads a page.
globalThis.Page = () => {};
globalThis.Component = () => {};
globalThis.App = () => {};
globalThis.wx = {};

function collectJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : collectJavaScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });
}

function verifyIdentityImports() {
  const identity = require(join(root, 'services/identity.js'));
  const exportedNames = new Set(Object.keys(identity));
  const pattern = /const\s*{([^}]+)}\s*=\s*require\(['\"][^'\"]*services\/identity['\"]\)/g;
  for (const filePath of collectJavaScriptFiles(root)) {
    const source = readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const names = match[1].split(',').map((item) => item.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      for (const name of names) {
        if (!exportedNames.has(name)) failures.push(`${filePath.slice(root.length + 1)} imports missing identity service ${name}`);
      }
    }
  }
}

function verifyTemplate(base, label, requireAllFiles) {
  if (visited.has(base)) return;
  visited.add(base);

  const pageBase = join(root, base);
  const jsonPath = `${pageBase}.json`;
  const jsPath = `${pageBase}.js`;
  const templatePath = `${pageBase}.wxml`;
  for (const extension of requiredExtensions) {
    if (requireAllFiles && !existsSync(`${pageBase}${extension}`)) failures.push(`${label}${extension} is missing`);
  }
  if (!existsSync(jsPath) || !existsSync(templatePath)) return;

  try {
    require(jsPath);
  } catch (error) {
    failures.push(`${label}: module cannot load (${error.message})`);
    return;
  }

  const source = readFileSync(jsPath, 'utf8');
  const template = readFileSync(templatePath, 'utf8');
  const handlers = new Set([...template.matchAll(eventPattern)].map((match) => match[1]));
  for (const handler of handlers) {
    const definition = new RegExp(`(?:\\b${handler}\\s*\\(|\\b${handler}\\s*:)`);
    if (!definition.test(source)) failures.push(`${label}: event handler ${handler} has no implementation`);
  }

  if (!existsSync(jsonPath)) return;
  const config = JSON.parse(readFileSync(jsonPath, 'utf8'));
  for (const componentPath of Object.values(config.usingComponents || {})) {
    const normalized = String(componentPath).replace(/^\//, '');
    verifyTemplate(normalized, normalized, false);
  }
}

for (const route of routes) verifyTemplate(route, route, true);
verifyIdentityImports();

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`page contract check passed for ${routes.length} registered routes`);
