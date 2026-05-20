const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error('Usage: node scripts/with-esbuild.cjs <vite|vitest> [args...]');
  process.exit(1);
}

function findEsbuildBinary() {
  const esbuildPackageDir = path.dirname(require.resolve('esbuild/package.json'));
  const esbuildVendorDir = path.join(esbuildPackageDir, 'node_modules', '@esbuild');
  const platformPrefix = `${process.platform}-${process.arch}`;

  const candidates = fs
    .readdirSync(esbuildVendorDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.includes(platformPrefix))
    .map((entry) => path.join(esbuildVendorDir, entry.name, 'esbuild.exe'))
    .filter((candidate) => fs.existsSync(candidate));

  if (!candidates.length) {
    throw new Error(`Could not locate the esbuild binary under ${esbuildVendorDir}`);
  }

  return candidates[0];
}

function stageEsbuildBinary(sourceBinary) {
  const targetDir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'memories', 'esbuild-cache');
  const targetBinary = path.join(targetDir, 'esbuild.exe');

  fs.mkdirSync(targetDir, { recursive: true });

  const sourceStat = fs.statSync(sourceBinary);
  const targetStat = fs.existsSync(targetBinary) ? fs.statSync(targetBinary) : null;

  if (!targetStat || sourceStat.mtimeMs > targetStat.mtimeMs || sourceStat.size !== targetStat.size) {
    fs.copyFileSync(sourceBinary, targetBinary);
    fs.chmodSync(targetBinary, 0o755);
  }

  return targetBinary;
}

function resolveCommandBinary(name) {
  if (name === 'vite' || name === 'vitest') {
    const packageJsonPath = require.resolve(`${name}/package.json`);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const binField = typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.[name] || Object.values(packageJson.bin || {})[0];

    if (!binField) {
      throw new Error(`Could not resolve the ${name} binary`);
    }

    return path.join(path.dirname(packageJsonPath), binField);
  }

  return name;
}

const sourceBinary = findEsbuildBinary();
const stagedBinary = stageEsbuildBinary(sourceBinary);
const env = {
  ...process.env,
  ESBUILD_BINARY_PATH: stagedBinary,
};

const commandBinary = resolveCommandBinary(command);
const finalArgs = command === 'vite' && !args.includes('--configLoader')
  ? ['--configLoader', 'runner', ...args]
  : args;

const preloadShim = path.join(process.cwd(), 'scripts', 'vite-child-process-shim.cjs');
const child = spawn(process.execPath, ['-r', preloadShim, commandBinary, ...finalArgs], {
  stdio: 'inherit',
  env,
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
