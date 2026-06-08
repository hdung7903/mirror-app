export type DeviceMeta = {
  deviceName: string;
  width: number;
  height: number;
};

export type TouchAction = 'down' | 'move' | 'up';
export type StreamCodec = 'h264' | 'h265';

type DecoderStats = {
  fps: number;
  latency: number;
  packets: number;
  decodedFrames: number;
  resolution: {
    w: number;
    h: number;
  };
};

type DecoderEvents = {
  frame: (stats: DecoderStats) => void;
  error: (error: Error) => void;
  connected: (meta: DeviceMeta) => void;
  disconnected: () => void;
};

type ScrcpyMetaMessage = DeviceMeta & {
  type: 'meta';
};

const PACKET_HEADER_BYTES = 12;
const CONNECT_META_TIMEOUT_MS = 12_000;
const SCRCPY_PACKET_FLAG_CONFIG = 1n << 63n;
const SCRCPY_PACKET_FLAG_KEY_FRAME = 1n << 62n;
const SCRCPY_PACKET_PTS_MASK = ~(SCRCPY_PACKET_FLAG_CONFIG | SCRCPY_PACKET_FLAG_KEY_FRAME);
const TOUCH_MESSAGE_BYTES = 28;
const TOUCH_TYPE = 0x02;
const ACTION_DOWN = 0;
const ACTION_UP = 1;
const ACTION_MOVE = 2;
const DEFAULT_POINTER_ID = 0n;
const DEFAULT_PRESSURE = 0xffff;
const PRIMARY_BUTTON = 1;

export class H264Decoder {
  private decoder?: VideoDecoder;
  private socket?: WebSocket;
  private ctx: CanvasRenderingContext2D;
  private sps?: Uint8Array;
  private pps?: Uint8Array;
  private configured = false;
  private waitingForKeyFrame = true;
  private meta?: DeviceMeta;
  private frameCount = 0;
  private lastFpsTime = performance.now();
  private lastPtsUs = 0;
  private packets = 0;
  private decodedFrames = 0;
  private listeners: Partial<{ [K in keyof DecoderEvents]: Set<DecoderEvents[K]> }> = {};
  private stats: DecoderStats = {
    fps: 0,
    latency: 0,
    packets: 0,
    decodedFrames: 0,
    resolution: { w: 0, h: 0 },
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly codec: StreamCodec = 'h264',
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is not available.');
    }
    this.ctx = ctx;
  }

  async connect(wsPort: number): Promise<DeviceMeta> {
    if (!('VideoDecoder' in window)) {
      throw new Error(
        'WebCodecs VideoDecoder is not supported in this WebView. Update Microsoft Edge WebView2 or run PhantomMirror in a Chromium-based runtime with WebCodecs enabled.',
      );
    }

    this.disconnect();

    return new Promise<DeviceMeta>((resolve, reject) => {
      let metaResolved = false;
      const timeoutId = window.setTimeout(() => {
        if (metaResolved) {
          return;
        }
        const error = new Error('Timed out waiting for stream metadata from scrcpy bridge.');
        this.emit('error', error);
        this.disconnect();
        reject(error);
      }, CONNECT_META_TIMEOUT_MS);
      const socket = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      this.socket = socket;
      socket.binaryType = 'arraybuffer';

      socket.onerror = () => {
        const error = new Error(`Failed to connect to scrcpy stream bridge at ws://127.0.0.1:${wsPort}.`);
        this.emit('error', error);
        if (!metaResolved) {
          window.clearTimeout(timeoutId);
          reject(error);
        }
      };

      socket.onclose = () => {
        if (!metaResolved) {
          window.clearTimeout(timeoutId);
          reject(new Error('Stream bridge closed before metadata was received.'));
        }
        this.emit('disconnected');
      };

      socket.onmessage = (event) => {
        void this.handleSocketMessage(event)
          .then((meta) => {
            if (meta && !metaResolved) {
              metaResolved = true;
              window.clearTimeout(timeoutId);
              this.emit('connected', meta);
              resolve(meta);
            }
          })
          .catch((error: unknown) => {
            const normalized = error instanceof Error ? error : new Error(String(error));
            this.emit('error', normalized);
            if (!metaResolved) {
              window.clearTimeout(timeoutId);
              reject(normalized);
            }
          });
      };
    });
  }

  on<K extends keyof DecoderEvents>(event: K, callback: DecoderEvents[K]) {
    const bucket = this.listeners[event] ?? new Set();
    bucket.add(callback);
    this.listeners[event] = bucket as never;
  }

  off<K extends keyof DecoderEvents>(event: K, callback: DecoderEvents[K]) {
    this.listeners[event]?.delete(callback as never);
  }

  sendTouch(x: number, y: number, action: TouchAction): void {
    if (!this.meta) {
      this.emit('error', new Error('Cannot send touch event before stream metadata is available.'));
      return;
    }

    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.emit('error', new Error('Cannot send touch event because stream WebSocket is not open.'));
      return;
    }

    const normalizedX = clamp01(x);
    const normalizedY = clamp01(y);
    const deviceX = Math.round(normalizedX * this.meta.width);
    const deviceY = Math.round(normalizedY * this.meta.height);
    socket.send(buildTouchMessage(action, deviceX, deviceY, this.meta.width, this.meta.height));
  }

  sendSwipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): void {
    const safeDuration = Math.max(16, durationMs);
    const moveCount = Math.max(2, Math.ceil(safeDuration / 16));
    this.sendTouch(x1, y1, 'down');

    for (let index = 1; index <= moveCount; index += 1) {
      const progress = index / (moveCount + 1);
      const x = x1 + (x2 - x1) * progress;
      const y = y1 + (y2 - y1) * progress;
      window.setTimeout(() => this.sendTouch(x, y, 'move'), Math.round(progress * safeDuration));
    }

    window.setTimeout(() => this.sendTouch(x2, y2, 'up'), safeDuration);
  }

  getStats(): DecoderStats {
    return {
      fps: this.stats.fps,
      latency: this.stats.latency,
      packets: this.stats.packets,
      decodedFrames: this.stats.decodedFrames,
      resolution: { ...this.stats.resolution },
    };
  }

  disconnect(): void {
    this.socket?.close();
    this.decoder?.close();
    this.socket = undefined;
    this.decoder = undefined;
    this.sps = undefined;
    this.pps = undefined;
    this.configured = false;
    this.waitingForKeyFrame = true;
    this.meta = undefined;
    this.frameCount = 0;
    this.packets = 0;
    this.decodedFrames = 0;
    this.lastFpsTime = performance.now();
    this.lastPtsUs = 0;
    this.stats.packets = 0;
    this.stats.decodedFrames = 0;
  }

  private async handleSocketMessage(event: MessageEvent): Promise<DeviceMeta | undefined> {
    if (typeof event.data === 'string') {
      return this.handleTextFrame(event.data);
    }

    if (event.data instanceof ArrayBuffer) {
      await this.handleBinaryFrame(event.data);
      return undefined;
    }

    if (event.data instanceof Blob) {
      await this.handleBinaryFrame(await event.data.arrayBuffer());
      return undefined;
    }

    throw new Error('Unsupported stream WebSocket message type.');
  }

  private handleTextFrame(data: string): DeviceMeta | undefined {
    const parsed = JSON.parse(data) as Partial<ScrcpyMetaMessage>;
    if (parsed.type !== 'meta') {
      return undefined;
    }

    if (
      typeof parsed.deviceName !== 'string' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number'
    ) {
      throw new Error('Invalid scrcpy stream metadata frame.');
    }

    const meta: DeviceMeta = {
      deviceName: parsed.deviceName,
      width: parsed.width,
      height: parsed.height,
    };

    this.meta = meta;
    this.canvas.width = meta.width;
    this.canvas.height = meta.height;
    this.stats.resolution = { w: meta.width, h: meta.height };
    return meta;
  }

  private async handleBinaryFrame(data: ArrayBuffer): Promise<void> {
    if (data.byteLength < PACKET_HEADER_BYTES) {
      throw new Error(`Invalid scrcpy frame: expected at least ${PACKET_HEADER_BYTES} bytes.`);
    }

    const view = new DataView(data);
    const ptsFlags = view.getBigUint64(0, false);
    const isConfigPacket = (ptsFlags & SCRCPY_PACKET_FLAG_CONFIG) !== 0n;
    const isKeyFramePacket = (ptsFlags & SCRCPY_PACKET_FLAG_KEY_FRAME) !== 0n;
    const pts = Number(ptsFlags & SCRCPY_PACKET_PTS_MASK);
    const size = view.getUint32(8, false);
    const packetSize = PACKET_HEADER_BYTES + size;
    if (packetSize > data.byteLength) {
      throw new Error(`Invalid scrcpy frame size: header says ${size}, received ${data.byteLength}.`);
    }

    const nalBytes = new Uint8Array(data, PACKET_HEADER_BYTES, size);
    this.packets += 1;
    this.stats.packets = this.packets;
    this.lastPtsUs = pts;

    const units = splitAnnexBNalUnits(nalBytes);
    let configChanged = false;
    for (const unit of units) {
      if (unit.byteLength === 0) {
        continue;
      }

      const nalType = this.nalType(unit);
      if (this.codec === 'h264' && nalType === 7) {
        const nextSps = copyBytes(unit);
        if (!this.sps || !bytesEqual(this.sps, nextSps)) {
          this.sps = nextSps;
          configChanged = true;
        }
      } else if (this.codec === 'h264' && nalType === 8) {
        const nextPps = copyBytes(unit);
        if (!this.pps || !bytesEqual(this.pps, nextPps)) {
          this.pps = nextPps;
          configChanged = true;
        }
      }
    }

    if (configChanged) {
      this.configureIfReady();
    }
    if (this.codec === 'h265' && !this.configured) {
      this.configureIfReady();
    }

    if (isConfigPacket) {
      return;
    }

    const hasKeyFrameSlice = isKeyFramePacket || units.some((unit) => this.isKeyFrameNal(unit));
    const hasVideoSlice = units.some((unit) => {
      return this.isVideoSliceNal(unit);
    });

    if (hasVideoSlice && (this.configured || this.codec === 'h265') && this.decoder) {
      if (this.waitingForKeyFrame && !hasKeyFrameSlice) {
        return;
      }
      this.waitingForKeyFrame = false;

      const chunkData = this.codec === 'h264' ? annexBAccessUnitToAvcc(nalBytes) : copyBytes(nalBytes);
      this.decoder.decode(
        new EncodedVideoChunk({
          type: hasKeyFrameSlice ? 'key' : 'delta',
          timestamp: pts,
          data: chunkData,
        }),
      );
    }
  }

  private configureIfReady(): void {
    if (this.codec === 'h265') {
      this.setupVideoDecoder();
      return;
    }
    if (this.sps && this.pps) {
      this.setupVideoDecoder(this.sps, this.pps);
    }
  }

  private setupVideoDecoder(sps?: Uint8Array, pps?: Uint8Array): void {
    this.decoder?.close();
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.updateFrameResolution(frame);
        this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
        frame.close();
        this.decodedFrames += 1;
        this.stats.decodedFrames = this.decodedFrames;
        this.updateFps();
      },
      error: (error) => this.emit('error', error),
    });

    if (this.codec === 'h265') {
      this.decoder.configure({
        codec: 'hev1.1.6.L150.B0',
        hardwareAcceleration: 'prefer-hardware',
        optimizeForLatency: true,
      });
    } else if (sps && pps) {
      this.decoder.configure({
        codec: `avc1.${extractProfileFromSPS(sps)}`,
        description: buildAvcDecoderDescription(sps, pps),
        hardwareAcceleration: 'prefer-hardware',
        optimizeForLatency: true,
      });
    } else {
      throw new Error('H.264 decoder requires SPS/PPS before configuration.');
    }
    this.configured = true;
    this.waitingForKeyFrame = true;
  }

  private nalType(unit: Uint8Array): number {
    if (this.codec === 'h265') {
      return unit.byteLength >= 2 ? (unit[0] >> 1) & 0x3f : -1;
    }
    return unit[0] & 0x1f;
  }

  private isKeyFrameNal(unit: Uint8Array): boolean {
    const nalType = this.nalType(unit);
    return this.codec === 'h265' ? nalType >= 16 && nalType <= 21 : nalType === 5;
  }

  private isVideoSliceNal(unit: Uint8Array): boolean {
    const nalType = this.nalType(unit);
    return this.codec === 'h265' ? nalType <= 31 : nalType === 5 || nalType === 1;
  }

  private updateFrameResolution(frame: VideoFrame): void {
    const width = Math.max(1, Math.round(frame.displayWidth || frame.codedWidth));
    const height = Math.max(1, Math.round(frame.displayHeight || frame.codedHeight));
    if (width === this.stats.resolution.w && height === this.stats.resolution.h) {
      return;
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.stats.resolution = { w: width, h: height };
    this.meta = {
      deviceName: this.meta?.deviceName ?? 'Android device',
      width,
      height,
    };
  }

  private updateFps(): void {
    this.frameCount += 1;
    const now = performance.now();
    const elapsed = now - this.lastFpsTime;
    if (elapsed >= 1000) {
      this.stats.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.stats.latency = this.lastPtsUs > 0 ? Math.max(0, Math.round(now - this.lastPtsUs / 1000)) : 0;
      this.frameCount = 0;
      this.lastFpsTime = now;
      this.emit('frame', this.getStats());
    }
  }

  private emit<K extends keyof DecoderEvents>(event: K, ...args: Parameters<DecoderEvents[K]>) {
    this.listeners[event]?.forEach((callback) => {
      (callback as (...callbackArgs: Parameters<DecoderEvents[K]>) => void)(...args);
    });
  }
}

export const VideoStreamDecoder = H264Decoder;

export function extractProfileFromSPS(sps: Uint8Array): string {
  const raw = stripStartCode(sps);
  if (raw.byteLength < 4) {
    return '42001E';
  }

  const profileIdc = raw[1];
  const constraintFlags = raw[2];
  const levelIdc = raw[3];
  return [profileIdc, constraintFlags, levelIdc]
    .map((value) => value.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

function buildTouchMessage(
  action: TouchAction,
  x: number,
  y: number,
  width: number,
  height: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(TOUCH_MESSAGE_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, TOUCH_TYPE);
  view.setUint8(1, actionToScrcpy(action));
  view.setBigUint64(2, DEFAULT_POINTER_ID, false);
  view.setInt32(10, x, false);
  view.setInt32(14, y, false);
  view.setUint16(18, width, false);
  view.setUint16(20, height, false);
  view.setUint16(22, action === 'up' ? 0 : DEFAULT_PRESSURE, false);
  view.setUint32(24, action === 'up' ? 0 : PRIMARY_BUTTON, false);
  return buffer;
}

function actionToScrcpy(action: TouchAction): number {
  switch (action) {
    case 'down':
      return ACTION_DOWN;
    case 'up':
      return ACTION_UP;
    case 'move':
      return ACTION_MOVE;
  }
}

function splitAnnexBNalUnits(bytes: Uint8Array): Uint8Array[] {
  const ranges: Array<[number, number]> = [];
  let start = findStartCode(bytes, 0);
  if (start < 0) {
    return [bytes];
  }

  while (start >= 0) {
    const payloadStart = start + startCodeLength(bytes, start);
    const nextStart = findStartCode(bytes, payloadStart);
    ranges.push([payloadStart, nextStart >= 0 ? nextStart : bytes.byteLength]);
    start = nextStart;
  }

  return ranges.map(([from, to]) => bytes.subarray(from, to)).filter((unit) => unit.byteLength > 0);
}

function findStartCode(bytes: Uint8Array, offset: number): number {
  for (let index = offset; index < bytes.byteLength - 3; index += 1) {
    if (bytes[index] === 0 && bytes[index + 1] === 0) {
      if (bytes[index + 2] === 1) {
        return index;
      }
      if (bytes[index + 2] === 0 && bytes[index + 3] === 1) {
        return index;
      }
    }
  }
  return -1;
}

function startCodeLength(bytes: Uint8Array, index: number): number {
  return bytes[index + 2] === 1 ? 3 : 4;
}

function stripStartCode(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 1) {
    return bytes.subarray(4);
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1) {
    return bytes.subarray(3);
  }
  return bytes;
}

function annexBAccessUnitToAvcc(bytes: Uint8Array): Uint8Array {
  const units = splitAnnexBNalUnits(bytes).map(stripStartCode).filter((unit) => unit.byteLength > 0);
  if (units.length === 0) {
    return bytes;
  }

  const totalBytes = units.reduce((sum, unit) => sum + 4 + unit.byteLength, 0);
  const output = new Uint8Array(totalBytes);
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const unit of units) {
    view.setUint32(offset, unit.byteLength, false);
    offset += 4;
    output.set(unit, offset);
    offset += unit.byteLength;
  }
  return output;
}

function buildAvcDecoderDescription(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const rawSps = stripStartCode(sps);
  const rawPps = stripStartCode(pps);
  const description = new Uint8Array(11 + rawSps.byteLength + rawPps.byteLength);
  let offset = 0;
  description[offset++] = 1;
  description[offset++] = rawSps[1] ?? 0x42;
  description[offset++] = rawSps[2] ?? 0;
  description[offset++] = rawSps[3] ?? 0x1e;
  description[offset++] = 0xff;
  description[offset++] = 0xe1;
  description[offset++] = (rawSps.byteLength >> 8) & 0xff;
  description[offset++] = rawSps.byteLength & 0xff;
  description.set(rawSps, offset);
  offset += rawSps.byteLength;
  description[offset++] = 1;
  description[offset++] = (rawPps.byteLength >> 8) & 0xff;
  description[offset++] = rawPps.byteLength & 0xff;
  description.set(rawPps, offset);
  return description;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
