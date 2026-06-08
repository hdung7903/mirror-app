type DecoderStats = {
  fps: number;
  frames: number;
  connected: boolean;
};

type DecoderEvents = {
  frame: (stats: DecoderStats) => void;
  error: (error: Error) => void;
  connected: () => void;
  disconnected: () => void;
};

export class H264Decoder {
  private decoder?: VideoDecoder;
  private socket?: WebSocket;
  private ctx: CanvasRenderingContext2D;
  private frameCount = 0;
  private lastFpsTime = performance.now();
  private listeners: Partial<{ [K in keyof DecoderEvents]: Set<DecoderEvents[K]> }> = {};
  private stats: DecoderStats = { fps: 0, frames: 0, connected: false };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly wsPort: number,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is not available.');
    }
    this.ctx = ctx;
  }

  on<K extends keyof DecoderEvents>(event: K, callback: DecoderEvents[K]) {
    const bucket = this.listeners[event] ?? new Set();
    bucket.add(callback);
    this.listeners[event] = bucket as never;
  }

  off<K extends keyof DecoderEvents>(event: K, callback: DecoderEvents[K]) {
    this.listeners[event]?.delete(callback as never);
  }

  connect() {
    if (!('VideoDecoder' in window)) {
      throw new Error('WebCodecs VideoDecoder is not supported by this WebView.');
    }

    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
        frame.close();
        this.updateFps();
      },
      error: (error) => this.emit('error', error),
    });

    this.decoder.configure({
      codec: 'avc1.42001E',
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: true,
    });

    this.socket = new WebSocket(`ws://127.0.0.1:${this.wsPort}`);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = () => {
      this.stats.connected = true;
      this.emit('connected');
    };
    this.socket.onclose = () => {
      this.stats.connected = false;
      this.emit('disconnected');
    };
    this.socket.onerror = () => this.emit('error', new Error('Stream socket failed.'));
    this.socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.processPacket(event.data);
      }
    };
  }

  disconnect() {
    this.socket?.close();
    this.decoder?.close();
    this.socket = undefined;
    this.decoder = undefined;
    this.stats.connected = false;
  }

  getStats() {
    return { ...this.stats };
  }

  private processPacket(data: ArrayBuffer) {
    if (!this.decoder || data.byteLength === 0) {
      return;
    }

    const chunk = new EncodedVideoChunk({
      type: this.isKeyFrame(data) ? 'key' : 'delta',
      timestamp: Math.round(performance.now() * 1000),
      data,
    });
    this.decoder.decode(chunk);
  }

  private isKeyFrame(data: ArrayBuffer) {
    const bytes = new Uint8Array(data);
    for (let index = 0; index < bytes.length - 5; index += 1) {
      const startCode3 = bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 1;
      const startCode4 =
        bytes[index] === 0 &&
        bytes[index + 1] === 0 &&
        bytes[index + 2] === 0 &&
        bytes[index + 3] === 1;
      const nalIndex = startCode4 ? index + 4 : startCode3 ? index + 3 : -1;
      if (nalIndex >= 0) {
        const nalType = bytes[nalIndex] & 0x1f;
        if (nalType === 5 || nalType === 7) {
          return true;
        }
      }
    }
    return false;
  }

  private updateFps() {
    this.frameCount += 1;
    this.stats.frames += 1;
    const now = performance.now();
    const elapsed = now - this.lastFpsTime;
    if (elapsed >= 1000) {
      this.stats.fps = Math.round((this.frameCount * 1000) / elapsed);
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
