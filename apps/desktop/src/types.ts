export type DeviceKind = 'android' | 'ios';

export type ConnectionKind = 'usb' | 'wifi' | 'airplay' | 'unknown';

export type MirrorStatus = 'offline' | 'connecting' | 'ready' | 'streaming' | 'error';

export type LayoutMode = 'grid' | 'focus' | 'single';

export type Device = {
  id: string;
  serial: string;
  name: string;
  model: string;
  kind: DeviceKind;
  connection: ConnectionKind;
  resolution?: {
    width: number;
    height: number;
  };
  androidVersion?: string;
  battery?: number;
  status: MirrorStatus;
  streamPort?: number;
  codec?: 'h264' | 'h265';
  latencyMs?: number;
  fps?: number;
  viewOnly?: boolean;
  rtspUrl?: string;
  airplaySessionId?: string;
};

export type DeviceInfo = {
  serial: string;
  battery?: number;
  androidVersion?: string;
  storageFree?: string;
};

export type DeviceChangedEvent = {
  serial: string;
  status: 'connected' | 'disconnected';
};

export type WifiDevice = {
  ip: string;
  port: number;
  name: string;
};

export type AirPlaySession = {
  rtspUrl: string;
  sessionId: string;
  deviceName: string;
};

export type UxPlayStatus = {
  installed: boolean;
  path?: string;
  version?: string;
};

export type IosMirrorInfo = {
  sessionId: string;
  wsPort: number;
  rtpPort: number;
  codec: 'h264' | 'h265';
  deviceName: string;
};

export type TouchPoint = {
  x: number;
  y: number;
};

export type SwipeInput = {
  from: TouchPoint;
  to: TouchPoint;
  durationMs: number;
};

export type ScanResult = {
  devices: Device[];
  adbAvailable: boolean;
  message?: string;
};
