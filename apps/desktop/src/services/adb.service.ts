import { invoke } from '@tauri-apps/api/core';
import type { Device, ScanResult, SwipeInput, TouchPoint } from '../types';

const isTauri = () => Boolean('__TAURI_INTERNALS__' in window);

const demoDevices: Device[] = [
  {
    id: 'demo-pixel',
    serial: 'demo-pixel',
    name: 'Pixel Demo',
    model: 'Android preview',
    kind: 'android',
    connection: 'usb',
    resolution: { width: 1080, height: 2400 },
    androidVersion: '14',
    battery: 86,
    status: 'ready',
    latencyMs: 42,
    fps: 0,
  },
  {
    id: 'demo-tablet',
    serial: 'demo-tablet',
    name: 'Tablet Demo',
    model: 'Tablet preview',
    kind: 'android',
    connection: 'wifi',
    resolution: { width: 1600, height: 2560 },
    androidVersion: '13',
    battery: 64,
    status: 'ready',
    latencyMs: 78,
    fps: 0,
  },
  {
    id: 'demo-ios',
    serial: 'demo-ios',
    name: 'iPhone AirPlay',
    model: 'iOS placeholder',
    kind: 'ios',
    connection: 'airplay',
    resolution: { width: 1179, height: 2556 },
    status: 'ready',
    viewOnly: true,
    latencyMs: 140,
    fps: 0,
  },
];

export async function scanDevices(): Promise<ScanResult> {
  if (!isTauri()) {
    return {
      adbAvailable: false,
      devices: demoDevices,
      message: 'Running in browser preview. Tauri backend is not attached, showing demo devices.',
    };
  }

  return invoke<ScanResult>('scan_devices');
}

export async function connectWifiDevice(address: string): Promise<ScanResult> {
  if (!isTauri()) {
    return {
      adbAvailable: false,
      devices: demoDevices,
      message: `Browser preview cannot connect to ${address}.`,
    };
  }

  return invoke<ScanResult>('connect_wifi_device', { address });
}

export async function startMirror(serial: string): Promise<number> {
  if (!isTauri()) {
    return 0;
  }

  return invoke<number>('start_android_mirror', { serial });
}

export async function sendTap(serial: string, point: TouchPoint): Promise<void> {
  if (!isTauri() || serial.startsWith('demo-')) {
    return;
  }

  await invoke('send_tap', { serial, x: Math.round(point.x), y: Math.round(point.y) });
}

export async function sendSwipe(serial: string, input: SwipeInput): Promise<void> {
  if (!isTauri() || serial.startsWith('demo-')) {
    return;
  }

  await invoke('send_swipe', {
    serial,
    x1: Math.round(input.from.x),
    y1: Math.round(input.from.y),
    x2: Math.round(input.to.x),
    y2: Math.round(input.to.y),
    durationMs: input.durationMs,
  });
}
