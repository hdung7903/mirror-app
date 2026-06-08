import { useEffect, useRef } from 'react';
import type { Device } from '../types';

type StreamCanvasProps = {
  device: Device;
};

export function StreamCanvas({ device }: StreamCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#101820');
    gradient.addColorStop(0.55, '#18242c');
    gradient.addColorStop(1, '#243139');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(255,255,255,0.11)';
    ctx.lineWidth = 1 * dpr;
    for (let x = 0; x < canvas.width; x += 42 * dpr) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 42 * dpr) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = `${14 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(device.status === 'streaming' ? 'Waiting for H.264 stream' : device.name, canvas.width / 2, canvas.height / 2);
  }, [device.name, device.status, device.streamPort]);

  return <canvas ref={canvasRef} className="stream-canvas" />;
}
