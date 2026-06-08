#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TEST_DURATION_MS = 5000;
const HEADER_BYTES = 12;

const port = Number.parseInt(process.argv[2] ?? '', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Usage: node tools/scripts/test-stream.mjs <wsPort>');
  console.error('Example: node tools/scripts/test-stream.mjs 27184');
  process.exit(1);
}

if (typeof WebSocket !== 'function') {
  console.error('This script requires Node.js 20+ with the global WebSocket API.');
  process.exit(1);
}

const url = `ws://127.0.0.1:${port}`;
const socket = new WebSocket(url);
socket.binaryType = 'arraybuffer';

let meta;
let firstFrameSaved = false;
let frameCount = 0;
let totalBytes = 0;
let firstFrameAt = 0;

const startedAt = performance.now();
let done = false;

const finish = async (exitCode = 0) => {
  if (done) {
    return;
  }
  done = true;

  const elapsedMs = Math.max(1, performance.now() - (firstFrameAt || startedAt));
  const fps = frameCount > 0 ? (frameCount * 1000) / elapsedMs : 0;
  const averageFrameSize = frameCount > 0 ? totalBytes / frameCount : 0;

  console.log('');
  console.log('Stream test result');
  console.log(`URL: ${url}`);
  console.log(`Meta: ${meta ? JSON.stringify(meta) : 'not received'}`);
  console.log(`Frames: ${frameCount}`);
  console.log(`FPS: ${fps.toFixed(2)}`);
  console.log(`Average frame size: ${averageFrameSize.toFixed(0)} bytes`);
  console.log(`Total bytes: ${totalBytes}`);
  console.log(`First frame: ${firstFrameSaved ? resolve('first-frame.h264') : 'not saved'}`);

  socket.close();
  process.exit(exitCode);
};

const timer = setTimeout(() => {
  void finish(frameCount > 0 ? 0 : 2);
}, TEST_DURATION_MS);

socket.addEventListener('open', () => {
  console.log(`Connected to ${url}`);
});

socket.addEventListener('message', (event) => {
  void handleMessage(event.data).catch((error) => {
    console.error(`Failed to process stream frame: ${error.message}`);
    clearTimeout(timer);
    void finish(1);
  });
});

socket.addEventListener('error', () => {
  console.error(`Failed to connect to ${url}`);
  clearTimeout(timer);
  void finish(1);
});

socket.addEventListener('close', () => {
  if (!done) {
    console.error('WebSocket closed before test completed.');
    clearTimeout(timer);
    void finish(frameCount > 0 ? 0 : 1);
  }
});

async function handleMessage(data) {
  if (typeof data === 'string') {
    const parsed = JSON.parse(data);
    if (parsed.type === 'meta') {
      meta = {
        deviceName: parsed.deviceName,
        width: parsed.width,
        height: parsed.height,
      };
      console.log(`Meta: ${meta.deviceName} ${meta.width}x${meta.height}`);
    }
    return;
  }

  const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error(`binary frame too small: ${buffer.byteLength} bytes`);
  }

  const view = new DataView(buffer);
  const ptsHigh = view.getUint32(0, false);
  const ptsLow = view.getUint32(4, false);
  const pts = ptsHigh * 0x100000000 + ptsLow;
  const size = view.getUint32(8, false);
  const expectedSize = HEADER_BYTES + size;
  if (expectedSize > buffer.byteLength) {
    throw new Error(`invalid packet size ${size}, received ${buffer.byteLength}`);
  }

  const frame = new Uint8Array(buffer, HEADER_BYTES, size);
  frameCount += 1;
  totalBytes += size;
  firstFrameAt ||= performance.now();

  if (!firstFrameSaved) {
    await writeFile('first-frame.h264', frame);
    firstFrameSaved = true;
    console.log(`Saved first H.264 frame, pts=${pts}, size=${size} bytes`);
  }
}
