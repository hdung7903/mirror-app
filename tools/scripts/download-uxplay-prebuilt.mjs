#!/usr/bin/env node
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import https from 'node:https';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = 'FDH2/UxPlay';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(SCRIPT_DIR, '..', '..');
const TARGET = platformTarget();
const OUTPUT_DIR = resolve(PROJECT_DIR, 'tools', 'uxplay', TARGET.dir);
const OUTPUT_NAME = process.platform === 'win32' ? 'uxplay.exe' : 'uxplay';
const OUTPUT_PATH = resolve(OUTPUT_DIR, OUTPUT_NAME);

await mkdir(OUTPUT_DIR, { recursive: true });

const release = await githubJson(`https://api.github.com/repos/${REPO}/releases/latest`);
const asset = chooseAsset(release.assets ?? []);
if (!asset) {
  printBuildFallback(release.assets ?? []);
  process.exit(1);
}

const tempPath = resolve(OUTPUT_DIR, `${asset.name}.download`);
console.log(`Downloading ${asset.browser_download_url}`);
await download(asset.browser_download_url, tempPath);
await installAsset(tempPath, asset.name);
if (process.platform !== 'win32') {
  await chmod(OUTPUT_PATH, 0o755);
}
console.log(`UxPlay headless saved to ${OUTPUT_PATH}`);
console.log(`SHA256 ${await sha256(OUTPUT_PATH)}`);

function platformTarget() {
  const platformMap = {
    win32: 'win32',
    linux: 'linux',
    darwin: 'darwin',
  };
  const archMap = {
    x64: 'x64',
    arm64: 'arm64',
  };
  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];
  if (!platform || !arch) {
    console.error(`Unsupported platform: ${process.platform} ${process.arch}`);
    process.exit(1);
  }
  return {
    dir: `${platform}-${arch}`,
    platform,
    arch,
  };
}

function chooseAsset(assets) {
  const platformTokens =
    TARGET.platform === 'win32'
      ? ['win', 'windows']
      : TARGET.platform === 'darwin'
        ? ['darwin', 'mac', 'macos', 'osx']
        : ['linux'];
  const archTokens = TARGET.arch === 'x64' ? ['x64', 'x86_64', 'amd64'] : ['arm64', 'aarch64'];

  return assets.find((asset) => {
    const name = asset.name.toLowerCase();
    return (
      name.includes('uxplay') &&
      platformTokens.some((token) => name.includes(token)) &&
      archTokens.some((token) => name.includes(token)) &&
      (name.endsWith('.zip') || name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.exe'))
    );
  });
}

async function installAsset(downloadPath, assetName) {
  const lower = assetName.toLowerCase();
  if (lower.endsWith('.zip')) {
    const extractDir = resolve(OUTPUT_DIR, 'extract');
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    await powershell(['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${downloadPath}' -DestinationPath '${extractDir}' -Force`]);
    await copyFoundBinary(extractDir, downloadPath);
    return;
  }

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    const extractDir = resolve(OUTPUT_DIR, 'extract');
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    await run('tar', ['-xzf', downloadPath, '-C', extractDir]);
    await copyFoundBinary(extractDir, downloadPath);
    return;
  }

  await rm(OUTPUT_PATH, { force: true });
  await rename(downloadPath, OUTPUT_PATH);
}

async function copyFoundBinary(extractDir, downloadPath) {
  const binary = await findFile(extractDir, OUTPUT_NAME);
  if (!binary) {
    throw new Error(`Could not find ${OUTPUT_NAME} in downloaded asset.`);
  }
  await rm(OUTPUT_PATH, { force: true });
  await copyFile(binary, OUTPUT_PATH);
  await rm(extractDir, { recursive: true, force: true });
  await rm(downloadPath, { force: true });
}

async function findFile(root, fileName) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = await findFile(fullPath, fileName);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function printBuildFallback(assets) {
  console.error(`No prebuilt UxPlay headless asset found for ${TARGET.dir}.`);
  if (assets.length > 0) {
    console.error('Release assets checked:');
    for (const asset of assets) {
      console.error(`- ${asset.name}`);
    }
  }
  console.error('Build it into the project with:');
  console.error(process.platform === 'win32' ? 'powershell -ExecutionPolicy Bypass -File tools/scripts/build-uxplay.ps1' : 'bash tools/scripts/build-uxplay.sh');
}

function githubJson(url) {
  return new Promise((resolveRequest, reject) => {
    https
      .get(
        url,
        {
          headers: { 'User-Agent': 'phantom-mirror-download-uxplay-prebuilt' },
        },
        (response) => {
          if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400 && response.headers.location) {
            resolveRequest(githubJson(new URL(response.headers.location, url).toString()));
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`GitHub API returned HTTP ${response.statusCode}`));
            return;
          }
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => resolveRequest(JSON.parse(body)));
        },
      )
      .on('error', reject);
  });
}

function download(url, outputPath, redirects = 0) {
  if (redirects > 5) {
    return Promise.reject(new Error('Too many redirects.'));
  }
  return new Promise((resolveDownload, reject) => {
    https
      .get(url, (response) => {
        if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400 && response.headers.location) {
          response.resume();
          resolveDownload(download(new URL(response.headers.location, url).toString(), outputPath, redirects + 1));
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }
        const file = createWriteStream(outputPath);
        response.pipe(file);
        file.on('finish', () => file.close(resolveDownload));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

function powershell(args) {
  return run('powershell.exe', args);
}

function run(command, args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolveCommand();
      } else {
        reject(new Error(`${command} exited with status ${code}`));
      }
    });
  });
}

function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
    stream.on('error', reject);
  });
}
