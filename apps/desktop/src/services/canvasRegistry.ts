import type { Device } from '../types';

const canvases = new Map<string, { canvas: HTMLCanvasElement; device: Device }>();

export function registerDeviceCanvas(device: Device, canvas: HTMLCanvasElement): () => void {
  canvases.set(device.id, { canvas, device });
  return () => {
    const current = canvases.get(device.id);
    if (current?.canvas === canvas) {
      canvases.delete(device.id);
    }
  };
}

export function screenshotAllDevices(): number {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let saved = 0;

  for (const { canvas, device } of canvases.values()) {
    if (canvas.width <= 1 || canvas.height <= 1) {
      continue;
    }

    const link = document.createElement('a');
    const safeName = device.name.replace(/[^a-z0-9_-]+/gi, '_');
    link.download = `${safeName}_${timestamp}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    saved += 1;
  }

  return saved;
}
