#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v3.1';
const DOWNLOAD_URL = `https://github.com/Genymobile/scrcpy/releases/download/${VERSION}/scrcpy-server-${VERSION}`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(SCRIPT_DIR, '..', 'scrcpy-server', 'scrcpy-server.jar');
const MIN_EXPECTED_BYTES = 100_000;

await mkdir(dirname(OUTPUT_PATH), { recursive: true });

console.log(`Downloading ${DOWNLOAD_URL}`);
console.log(`Saving to ${OUTPUT_PATH}`);

await download(DOWNLOAD_URL, OUTPUT_PATH);

const file = await stat(OUTPUT_PATH);
if (file.size < MIN_EXPECTED_BYTES) {
  console.error(`Downloaded file is too small: ${file.size} bytes.`);
  process.exit(1);
}

const checksum = await sha256File(OUTPUT_PATH);
console.log(`Downloaded scrcpy server ${VERSION}`);
console.log(`Size: ${file.size} bytes`);
console.log(`SHA-256: ${checksum}`);

function download(url, outputPath, redirects = 0) {
  if (redirects > 5) {
    return Promise.reject(new Error('Too many redirects while downloading scrcpy server.'));
  }

  return new Promise((resolveDownload, reject) => {
    const request = https.get(url, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        const redirected = new URL(location, url).toString();
        resolveDownload(download(redirected, outputPath, redirects + 1));
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${status}.`));
        return;
      }

      const file = createWriteStream(outputPath);
      response.pipe(file);
      file.on('finish', () => file.close(resolveDownload));
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const request = https;
    import('node:fs').then(({ createReadStream }) => {
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolveHash(hash.digest('hex')));
      stream.on('error', reject);
    }).catch(reject);
  });
}
