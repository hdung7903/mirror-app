#!/usr/bin/env node
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import https from 'node:https';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UPSTREAM_REPO = 'FDH2/UxPlay';
const WINDOWS_REPO = 'leapbtw/uxplay-windows';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(SCRIPT_DIR, '..', 'uxplay');
const OUTPUT_NAME = os.platform() === 'win32' ? 'uxplay.exe' : 'uxplay';
const WINDOWS_APP_NAME = 'uxplay-windows.exe';
const OUTPUT_PATH = resolve(OUTPUT_DIR, OUTPUT_NAME);

await mkdir(OUTPUT_DIR, { recursive: true });

const release = await findReleaseWithAsset();
const asset = chooseAsset(release.assets ?? []);
if (!asset) {
  console.error(`No matching UxPlay binary asset found for ${os.platform()} ${os.arch()}.`);
  console.error('Assets found:');
  for (const item of release.assets ?? []) {
    console.error(`- ${item.name}`);
  }
  console.error(`Download manually from https://github.com/${release.repo}/releases and place uxplay at:`);
  console.error(OUTPUT_PATH);
  process.exit(1);
}

const tempPath = resolve(OUTPUT_DIR, `${asset.name}.download`);
console.log(`Downloading ${asset.browser_download_url}`);
await download(asset.browser_download_url, tempPath);
await installDownloadedAsset(tempPath, asset.name);
const installedPath = await resolveInstalledBinary();
if (!installedPath) {
  throw new Error(`Downloaded package did not install ${OUTPUT_NAME} or ${WINDOWS_APP_NAME}.`);
}
if (os.platform() !== 'win32') {
  await chmod(installedPath, 0o755);
}
console.log(`UxPlay saved to ${installedPath}`);
console.log(`SHA256 ${await sha256(installedPath)}`);

async function findReleaseWithAsset() {
  const repos = os.platform() === 'win32' ? [WINDOWS_REPO, UPSTREAM_REPO] : [UPSTREAM_REPO];
  let lastRelease;
  for (const repo of repos) {
    const release = await githubJson(`https://api.github.com/repos/${repo}/releases/latest`);
    release.repo = repo;
    lastRelease = release;
    if (chooseAsset(release.assets ?? [])) {
      return release;
    }
  }
  return lastRelease;
}

function chooseAsset(assets) {
  const platform = os.platform();
  const arch = os.arch();
  const platformTokens =
    platform === 'win32'
      ? ['win', 'windows']
      : platform === 'darwin'
        ? ['mac', 'macos', 'darwin', 'osx']
        : ['linux'];
  const archTokens = arch === 'x64' ? ['x64', 'x86_64', 'amd64'] : arch === 'arm64' ? ['arm64', 'aarch64'] : [arch];

  const preferred = assets.find((asset) => {
    const name = asset.name.toLowerCase();
    return (
      platformTokens.some((token) => name.includes(token)) &&
      assetMatchesArch(name, platform, archTokens) &&
      name.includes('portable') &&
      (name.includes('uxplay') || name.endsWith('.zip') || name.endsWith('.tar.gz') || name.endsWith('.exe'))
    );
  });
  if (preferred) {
    return preferred;
  }

  return assets.find((asset) => {
    const name = asset.name.toLowerCase();
    return (
      platformTokens.some((token) => name.includes(token)) &&
      assetMatchesArch(name, platform, archTokens) &&
      (name.includes('uxplay') || name.endsWith('.zip') || name.endsWith('.tar.gz') || name.endsWith('.exe'))
    );
  });
}

function assetMatchesArch(name, platform, archTokens) {
  if (archTokens.some((token) => name.includes(token))) {
    return true;
  }

  const knownArchTokens = ['x64', 'x86_64', 'amd64', 'arm64', 'aarch64', 'x86', 'i386', 'i686'];
  return platform === 'win32' && !knownArchTokens.some((token) => name.includes(token));
}

async function installDownloadedAsset(downloadPath, assetName) {
  const lower = assetName.toLowerCase();
  if (lower.endsWith('.zip')) {
    const extractDir = resolve(OUTPUT_DIR, 'extract');
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    await powershell(['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${downloadPath}' -DestinationPath '${extractDir}' -Force`]);
    const binary = await findFile(extractDir, OUTPUT_NAME) ?? await findFile(extractDir, WINDOWS_APP_NAME);
    if (!binary) {
      throw new Error(`Could not find ${OUTPUT_NAME} or ${WINDOWS_APP_NAME} inside ${assetName}.`);
    }
    await installExtractedPackage(extractDir);
    await rm(downloadPath, { force: true });
    return;
  }

  await rm(OUTPUT_PATH, { force: true });
  await rename(downloadPath, OUTPUT_PATH);
}

async function installExtractedPackage(extractDir) {
  const entries = await readdir(extractDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(extractDir, entry.name);
    const to = join(OUTPUT_DIR, entry.name);
    if (entry.name === 'extract') {
      continue;
    }
    await rm(to, { recursive: true, force: true });
    await rename(from, to);
  }
  await rm(extractDir, { recursive: true, force: true });
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

async function resolveInstalledBinary() {
  for (const candidate of [OUTPUT_PATH, resolve(OUTPUT_DIR, WINDOWS_APP_NAME)]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function powershell(args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn('powershell.exe', args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolveCommand();
      } else {
        reject(new Error(`PowerShell exited with status ${code}`));
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

function githubJson(url) {
  return new Promise((resolveRequest, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'phantom-mirror-download-uxplay',
          },
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
