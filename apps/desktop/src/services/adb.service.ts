import { invoke } from '@tauri-apps/api/core';
import type {
  Device,
  DeviceInfo,
  IosMirrorInfo,
  ScanResult,
  SwipeInput,
  TouchPoint,
  UxPlayStatus,
  WifiDevice,
} from '../types';

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

export async function scanWifiDevices(): Promise<WifiDevice[]> {
  if (!isTauri()) {
    return [
      { ip: '192.168.1.20', port: 5555, name: 'Demo wireless device' },
    ];
  }

  return invoke<WifiDevice[]>('scan_wifi_devices');
}

export async function scanLocalNetwork(): Promise<string[]> {
  if (!isTauri()) {
    return ['192.168.1.20'];
  }

  return invoke<string[]>('scan_local_network');
}

export async function pairWifiDevice(ip: string, port: number, code: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke('pair_wifi_device', { ip, port, code });
}

export async function startMirror(serial: string): Promise<number> {
  if (!isTauri()) {
    return 0;
  }

  return invoke<number>('start_android_mirror', { serial });
}

export async function startStreamBridge(serial: string, scrcpyTcpPort: number): Promise<number> {
  if (!isTauri()) {
    return 0;
  }

  return invoke<number>('start_stream_bridge', { serial, scrcpyTcpPort });
}

export async function stopStreamBridge(serial: string): Promise<void> {
  if (!isTauri() || serial.startsWith('demo-')) {
    return;
  }

  await invoke('stop_stream_bridge', { serial });
}

export async function getDeviceInfo(serial: string): Promise<DeviceInfo> {
  if (!isTauri() || serial.startsWith('demo-')) {
    const device = demoDevices.find((item) => item.serial === serial);
    return {
      serial,
      battery: device?.battery,
      androidVersion: device?.androidVersion,
      storageFree: 'demo',
    };
  }

  return invoke<DeviceInfo>('get_device_info', { serial });
}

export async function isDeviceConnected(serial: string): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>('is_device_connected', { serial });
}

export async function rotateDevice(serial: string): Promise<void> {
  if (!isTauri() || serial.startsWith('demo-')) {
    return;
  }

  await invoke('rotate_device', { serial });
}

export async function restorePortraitIfHome(serial: string): Promise<boolean> {
  if (!isTauri() || serial.startsWith('demo-')) {
    return false;
  }

  return invoke<boolean>('restore_portrait_if_home', { serial });
}

export async function checkUxplayInstalled(): Promise<boolean> {
  return (await checkUxPlay()).installed;
}

export async function checkUxPlay(): Promise<UxPlayStatus> {
  if (!isTauri()) {
    return {
      installed: true,
      path: 'browser-preview',
      version: 'demo',
    };
  }

  return invoke<UxPlayStatus>('check_uxplay');
}

export async function startIosMirror(deviceName: string, quality: string): Promise<IosMirrorInfo> {
  if (!isTauri()) {
    return {
      sessionId: `demo-ios-${Date.now()}`,
      wsPort: 0,
      rtpPort: 0,
      codec: quality === '4k' ? 'h265' : 'h264',
      deviceName,
    };
  }

  return invoke<IosMirrorInfo>('start_ios_mirror', { deviceName, quality });
}

export async function stopIosMirror(sessionId: string): Promise<void> {
  if (!isTauri() || sessionId.startsWith('demo-')) {
    return;
  }

  await invoke('stop_ios_mirror', { sessionId });
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
