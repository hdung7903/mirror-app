import { useCallback, useEffect, useRef, useState } from 'react';
import { useDeviceStore } from '../stores/deviceStore';
import type { Device, DeviceChangedEvent, DeviceInfo } from '../types';
import {
  getDeviceInfo,
  isDeviceConnected,
  restorePortraitIfHome,
  startMirror,
  startStreamBridge,
  stopIosMirror,
  stopStreamBridge,
} from '../services/adb.service';
import { registerDeviceCanvas } from '../services/canvasRegistry';
import { openExtendedDisplayWindow, startExtendedDisplay } from '../services/extendedDisplay.service';
import { H264Decoder, type DeviceMeta } from '../h264decoder';
import { StreamCanvas } from './StreamCanvas';
import { TouchOverlay } from './TouchOverlay';

type DeviceWindowProps = {
  device: Device;
  focused: boolean;
};

export function DeviceWindow({ device, focused }: DeviceWindowProps) {
  const select = useDeviceStore((state) => state.select);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<H264Decoder | null>(null);
  const reconnectTimerRef = useRef<number | undefined>();
  const reconnectAttemptsRef = useRef(0);
  const userWantsStreamRef = useRef(false);
  const manualCloseRef = useRef(false);
  const connectingRef = useRef(false);
  const connectStreamRef = useRef<(isReconnect?: boolean) => Promise<void>>();
  const lastStreamErrorRef = useRef<string | undefined>();
  const [streamState, setStreamState] = useState<'idle' | 'connecting' | 'ready' | 'error'>('idle');
  const [streamError, setStreamError] = useState<string | undefined>();
  const [info, setInfo] = useState<DeviceInfo | undefined>();
  const [meta, setMeta] = useState<DeviceMeta | undefined>();
  const [extendedInfo, setExtendedInfo] = useState<string | undefined>();
  const [extendedDialogOpen, setExtendedDialogOpen] = useState(false);
  const [extendedHost, setExtendedHost] = useState(defaultExtendedHost());
  const [extendedStarting, setExtendedStarting] = useState(false);
  const [stats, setStats] = useState({
    fps: 0,
    latency: 0,
    packets: 0,
    decodedFrames: 0,
    resolution: { w: device.resolution?.width ?? 0, h: device.resolution?.height ?? 0 },
  });

  const currentResolution = stats.resolution.w > 0 && stats.resolution.h > 0
    ? stats.resolution
    : meta
      ? { w: meta.width, h: meta.height }
      : device.resolution
        ? { w: device.resolution.width, h: device.resolution.height }
        : undefined;
  const resolution = currentResolution
    ? `${currentResolution.w} x ${currentResolution.h}`
    : 'Unknown resolution';

  async function useAsExtendedDisplay(pcIp: string) {
    const host = pcIp.trim();
    if (!host) {
      return;
    }

    setExtendedStarting(true);
    const width = 1280;
    const height = 720;
    try {
      const port = await startExtendedDisplay(width, height);
      setExtendedInfo(`Install/run Android agent, then connect to ws://${host}:${port}`);
      setExtendedDialogOpen(false);
      await openExtendedDisplayWindow(port, width, height);
    } finally {
      setExtendedStarting(false);
    }
  }

  const cleanupStream = useCallback(async (stopBackend = true) => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    manualCloseRef.current = true;
    decoderRef.current?.disconnect();
    decoderRef.current = null;
    try {
      if (device.kind === 'ios' && device.airplaySessionId && stopBackend) {
        await stopIosMirror(device.airplaySessionId);
      } else {
        await stopStreamBridge(device.serial);
      }
    } catch (error) {
      console.warn('Failed to stop previous stream bridge before restart:', error);
    }
    window.setTimeout(() => {
      manualCloseRef.current = false;
    }, 500);
  }, [device.airplaySessionId, device.kind, device.serial]);

  const scheduleReconnect = useCallback(async () => {
    if (!userWantsStreamRef.current) {
      return;
    }

    const attempt = reconnectAttemptsRef.current;
    if (attempt >= 3) {
      setStreamState('error');
      const connected = device.kind === 'ios' || (await isDeviceConnected(device.serial));
      setStreamError(
        connected
          ? lastStreamErrorRef.current ?? 'Stream failed while the device is still connected. Retry mirror or reduce resolution.'
          : 'Disconnected - Plug in USB',
      );
      return;
    }

    const connected = device.kind === 'ios' || (await isDeviceConnected(device.serial));
    if (!connected) {
      setStreamState('error');
      setStreamError('Disconnected - Plug in USB');
      return;
    }

    const delay = 2000 * 2 ** attempt;
    reconnectAttemptsRef.current += 1;
    setStreamState('error');
    setStreamError(`Stream disconnected. Reconnecting in ${delay / 1000}s...`);
    reconnectTimerRef.current = window.setTimeout(() => {
      void connectStreamRef.current?.(true);
    }, delay);
  }, [device.serial]);

  const connectStream = useCallback(async (isReconnect = false) => {
    const canvas = canvasRef.current;
    if (!canvas || (device.viewOnly && device.kind !== 'ios') || connectingRef.current) {
      return;
    }

    userWantsStreamRef.current = true;
    if (!isReconnect) {
      reconnectAttemptsRef.current = 0;
    }
    connectingRef.current = true;
    await cleanupStream(device.kind !== 'ios');
    manualCloseRef.current = false;
    setStreamState('connecting');
    setStreamError(undefined);
    lastStreamErrorRef.current = undefined;

    try {
      const wsPort =
        device.kind === 'ios'
          ? device.streamPort ?? 0
          : await startAndroidStream(device.serial);
      if (device.kind === 'ios' && wsPort <= 0) {
        throw new Error('iOS mirror WebSocket port is not available.');
      }
      const decoder = new H264Decoder(canvas, device.codec ?? 'h264');
      decoderRef.current = decoder;
      decoder.on('frame', setStats);
      decoder.on('error', (error) => {
        if (manualCloseRef.current) {
          return;
        }
        lastStreamErrorRef.current = error.message;
        setStreamError(error.message);
        setStreamState('error');
      });
      decoder.on('disconnected', () => {
        if (manualCloseRef.current || !userWantsStreamRef.current) {
          return;
        }
        void scheduleReconnect();
      });
      const nextMeta = await decoder.connect(wsPort);
      setMeta(nextMeta);
      setStats(decoder.getStats());
      setStreamState('ready');
      reconnectAttemptsRef.current = 0;
    } catch (error) {
      await cleanupStream(device.kind !== 'ios');
      const message = error instanceof Error ? error.message : String(error);
      lastStreamErrorRef.current = message;
      setStreamError(message);
      setStreamState('error');
      void scheduleReconnect();
    } finally {
      connectingRef.current = false;
    }
  }, [cleanupStream, device.kind, device.rtspUrl, device.serial, device.viewOnly, scheduleReconnect]);

  connectStreamRef.current = connectStream;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    return registerDeviceCanvas(device, canvas);
  }, [device]);

  useEffect(() => {
    async function refreshInfo() {
      if (device.viewOnly || device.kind === 'ios') {
        return;
      }
      try {
        setInfo(await getDeviceInfo(device.serial));
      } catch {
        setInfo(undefined);
      }
    }

    void refreshInfo();
    const interval = window.setInterval(() => void refreshInfo(), 30000);
    return () => window.clearInterval(interval);
  }, [device.serial, device.viewOnly]);

  useEffect(() => {
    function handleDeviceChanged(event: Event) {
      const detail = (event as CustomEvent<DeviceChangedEvent>).detail;
      if (detail.serial !== device.serial) {
        return;
      }

      if (detail.status === 'connected' && userWantsStreamRef.current) {
        reconnectAttemptsRef.current = 0;
        void connectStreamRef.current?.(true);
      } else if (detail.status === 'disconnected') {
        void isDeviceConnected(device.serial).then((connected) => {
          if (!connected) {
            void cleanupStream();
            setStreamState('error');
            setStreamError('Disconnected - Plug in USB');
          }
        });
      }
    }

    window.addEventListener('phantommirror:device-changed', handleDeviceChanged);
    return () => window.removeEventListener('phantommirror:device-changed', handleDeviceChanged);
  }, [cleanupStream, device.serial]);

  useEffect(() => {
    function handleStartStream(event: Event) {
      const detail = (event as CustomEvent<{ serial: string }>).detail;
      if (detail.serial === device.serial || detail.serial === device.id) {
        void connectStreamRef.current?.();
      }
    }

    window.addEventListener('phantommirror:start-stream', handleStartStream);
    return () => window.removeEventListener('phantommirror:start-stream', handleStartStream);
  }, [device.id, device.serial]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('phantommirror:stream-status', {
        detail: {
          serial: device.serial,
          status: streamState,
          fps: stats.fps,
        },
      }),
    );
  }, [device.serial, stats.fps, streamState]);

  useEffect(() => () => {
    userWantsStreamRef.current = false;
    void cleanupStream();
  }, [cleanupStream]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const decoder = decoderRef.current;
      if (decoder) {
        setStats(decoder.getStats());
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (device.kind !== 'android' || streamState !== 'ready') {
      return undefined;
    }

    const interval = window.setInterval(() => {
      const { resolution: nextResolution } = decoderRef.current?.getStats() ?? {
        resolution: currentResolution ?? { w: 0, h: 0 },
      };
      if (nextResolution.w <= nextResolution.h) {
        return;
      }

      void restorePortraitIfHome(device.serial).catch((error) => {
        console.warn('Failed to restore portrait orientation:', error);
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [currentResolution, device.kind, device.serial, streamState]);

  return (
    <article className={`device-window ${focused ? 'focused' : ''}`} onClick={() => select(device.id)}>
      <header className="device-header">
        <div>
          <strong>{device.name}</strong>
          <span>{device.kind === 'ios' ? 'View Only' : resolution}</span>
          <div className="device-info-popover">
            <span>Battery: {info?.battery ?? device.battery ?? '--'}%</span>
            <span>Android: {info?.androidVersion ?? device.androidVersion ?? '--'}</span>
            <span>Storage free: {info?.storageFree ?? '--'}</span>
            <span>Serial: {device.serial}</span>
          </div>
        </div>
        <div className="device-metrics">
          <span>{stats.fps} fps</span>
          <span>{stats.packets}/{stats.decodedFrames}</span>
          <span>{stats.latency ? `${stats.latency} ms` : '-- ms'}</span>
        </div>
      </header>

      <div className="screen-frame">
        <StreamCanvas device={device} canvasRef={canvasRef} streamState={streamState} />
        {streamState === 'connecting' ? (
          <div className="stream-overlay">
            <span className="spinner" />
            <strong>Connecting to {device.name}...</strong>
          </div>
        ) : null}
        {device.kind === 'ios' && streamState === 'idle' ? (
          <div className="stream-overlay instructions">
            <strong>On iPhone</strong>
            <span>Control Center → Screen Mirroring → {device.name}</span>
          </div>
        ) : null}
        {streamState === 'error' ? (
          <div className="stream-overlay error">
            <strong>{streamError ?? 'Stream failed.'}</strong>
            <button type="button" onClick={() => void connectStream()}>
              Retry
            </button>
          </div>
        ) : null}
        {!device.viewOnly && streamState === 'ready' ? (
          <TouchOverlay device={device} decoderRef={decoderRef} />
        ) : device.viewOnly ? (
          <span className="view-only">View only</span>
        ) : null}
      </div>

      <footer className="device-toolbar">
        <button
          type="button"
          onClick={() => void connectStream()}
          disabled={(device.viewOnly && device.kind !== 'ios') || streamState === 'connecting'}
        >
          {streamState === 'ready' ? 'Restart' : device.kind === 'ios' ? 'Start View' : 'Mirror'}
        </button>
        <button type="button" disabled>
          Rotate
        </button>
        <button type="button" disabled>
          Shot
        </button>
        {device.kind === 'android' ? (
          <button type="button" onClick={() => setExtendedDialogOpen(true)}>
            Extended
          </button>
        ) : null}
        <span className={`status-label ${streamState}`}>{streamState}</span>
      </footer>
      {extendedInfo ? <div className="extended-hint">{extendedInfo}</div> : null}
      {extendedDialogOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setExtendedDialogOpen(false)}>
          <form
            className="extended-dialog"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void useAsExtendedDisplay(extendedHost);
            }}
          >
            <strong>Use as extended display</strong>
            <label>
              <span>PC IP address</span>
              <input
                value={extendedHost}
                placeholder="192.168.1.20"
                onChange={(event) => setExtendedHost(event.target.value)}
                autoFocus
              />
            </label>
            <p>Android agent will connect to this PC over Wi-Fi.</p>
            <div>
              <button type="button" onClick={() => setExtendedDialogOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={extendedStarting || !extendedHost.trim()}>
                {extendedStarting ? 'Starting...' : 'Start'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </article>
  );
}

async function startAndroidStream(serial: string) {
  const scrcpyPort = await startMirror(serial);
  return startStreamBridge(serial, scrcpyPort);
}

function defaultExtendedHost() {
  if (window.location.hostname && window.location.hostname !== 'localhost') {
    return window.location.hostname;
  }

  return '';
}
