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
  latencyMs?: number;
  fps?: number;
  viewOnly?: boolean;
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
