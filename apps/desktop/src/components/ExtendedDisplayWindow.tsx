import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';

type ExtTouch = {
  x: number;
  y: number;
  action: 'down' | 'move' | 'up';
};

type EncodedChunkLike = {
  copyTo(destination: ArrayBuffer): void;
  byteLength: number;
};

export function ExtendedDisplayWindow() {
  const params = new URLSearchParams(window.location.search);
  const port = Number(params.get('port') ?? 0);
  const width = Number(params.get('width') ?? 1280);
  const height = Number(params.get('height') ?? 720);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const encoderRef = useRef<VideoEncoder | null>(null);
  const frameTimerRef = useRef<number | undefined>();
  const [status, setStatus] = useState('Waiting for Android tablet');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setStatus('Canvas is unavailable');
      return undefined;
    }
    const drawingContext = ctx;

    let frame = 0;
    function draw() {
      frame += 1;
      const now = new Date();
      drawingContext.fillStyle = '#101316';
      drawingContext.fillRect(0, 0, width, height);
      drawingContext.fillStyle = '#74d8b8';
      drawingContext.fillRect(0, 0, width, 54);
      drawingContext.fillStyle = '#06100d';
      drawingContext.font = '700 20px system-ui, sans-serif';
      drawingContext.fillText('PhantomMirror Extended Display', 24, 34);
      drawingContext.fillStyle = '#edf4f7';
      drawingContext.font = '52px system-ui, sans-serif';
      drawingContext.fillText(now.toLocaleTimeString(), 42, 150);
      drawingContext.font = '18px system-ui, sans-serif';
      drawingContext.fillStyle = '#9baab2';
      drawingContext.fillText('Drag this window to another monitor. Content is encoded and streamed to Android.', 42, 195);
      drawingContext.strokeStyle = 'rgba(255,255,255,0.12)';
      for (let x = 42; x < width; x += 96) {
        drawingContext.beginPath();
        drawingContext.moveTo(x, 240);
        drawingContext.lineTo(x, height - 42);
        drawingContext.stroke();
      }
      for (let y = 240; y < height - 42; y += 72) {
        drawingContext.beginPath();
        drawingContext.moveTo(42, y);
        drawingContext.lineTo(width - 42, y);
        drawingContext.stroke();
      }
      drawingContext.fillStyle = '#243039';
      drawingContext.fillRect(42 + (frame % 320), 280, 180, 96);
      drawingContext.fillStyle = '#edf4f7';
      drawingContext.fillText('Live canvas source', 62 + (frame % 320), 335);
      requestAnimationFrame(draw);
    }
    draw();

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.binaryType = 'arraybuffer';
    wsRef.current = socket;
    socket.onopen = () => {
      setStatus(`Streaming on ws://PC:${port}`);
      startEncoder(canvas);
    };
    socket.onerror = () => setStatus('Extended display WebSocket failed');
    socket.onclose = () => setStatus('Extended display disconnected');

    return () => {
      if (frameTimerRef.current) {
        window.clearInterval(frameTimerRef.current);
      }
      encoderRef.current?.close();
      socket.close();
    };
  }, [height, port, width]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ExtTouch>('ext-touch', (event) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + event.payload.x * rect.width;
      const y = rect.top + event.payload.y * rect.height;
      const type =
        event.payload.action === 'down'
          ? 'mousedown'
          : event.payload.action === 'up'
            ? 'mouseup'
            : 'mousemove';
      canvas.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          buttons: event.payload.action === 'up' ? 0 : 1,
        }),
      );
    }).then((next) => {
      unlisten = next;
    });
    return () => unlisten?.();
  }, []);

  function startEncoder(canvas: HTMLCanvasElement) {
    if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
      setStatus('WebCodecs VideoEncoder is not available in this WebView');
      return;
    }

    const socket = wsRef.current;
    if (!socket) {
      return;
    }

    const encoder = new VideoEncoder({
      output: (chunk) => {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }
        const buffer = new ArrayBuffer((chunk as unknown as EncodedChunkLike).byteLength);
        chunk.copyTo(buffer);
        socket.send(buffer);
      },
      error: (error) => setStatus(error.message),
    });
    encoder.configure({
      codec: 'avc1.42001f',
      width,
      height,
      bitrate: 4_000_000,
      framerate: 30,
      hardwareAcceleration: 'prefer-hardware',
      avc: { format: 'annexb' },
    });
    encoderRef.current = encoder;

    let timestamp = 0;
    frameTimerRef.current = window.setInterval(() => {
      if (encoder.state !== 'configured') {
        return;
      }
      const frame = new VideoFrame(canvas, { timestamp });
      encoder.encode(frame, { keyFrame: timestamp % 1_000_000 === 0 });
      frame.close();
      timestamp += 33_333;
    }, 33);
  }

  return (
    <main className="extended-window">
      <canvas ref={canvasRef} />
      <div className="extended-status">{status}</div>
    </main>
  );
}
