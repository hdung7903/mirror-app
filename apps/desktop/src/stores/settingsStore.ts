import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutMode } from '../types';

export type VideoQuality = '480p' | '720p' | '1080p' | 'native';
export type ThemeMode = 'light' | 'dark' | 'system';

export type SettingsState = {
  streaming: {
    videoQuality: VideoQuality;
    fpsTarget: 30 | 60;
    bitrateMbps: number;
    h265: boolean;
  };
  interface: {
    theme: ThemeMode;
    defaultLayout: LayoutMode;
    showFpsCounter: boolean;
    showDeviceInfoOnHover: boolean;
  };
  connection: {
    autoReconnect: boolean;
    reconnectAttempts: 1 | 3 | 5;
    wifiScanTimeoutSec: 2 | 3 | 5;
  };
  setStreaming: (patch: Partial<SettingsState['streaming']>) => void;
  setInterface: (patch: Partial<SettingsState['interface']>) => void;
  setConnection: (patch: Partial<SettingsState['connection']>) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      streaming: {
        videoQuality: '1080p',
        fpsTarget: 60,
        bitrateMbps: 12,
        h265: false,
      },
      interface: {
        theme: 'dark',
        defaultLayout: 'grid',
        showFpsCounter: true,
        showDeviceInfoOnHover: true,
      },
      connection: {
        autoReconnect: true,
        reconnectAttempts: 3,
        wifiScanTimeoutSec: 3,
      },
      setStreaming: (patch) => set((state) => ({ streaming: { ...state.streaming, ...patch } })),
      setInterface: (patch) => set((state) => ({ interface: { ...state.interface, ...patch } })),
      setConnection: (patch) => set((state) => ({ connection: { ...state.connection, ...patch } })),
    }),
    {
      name: 'phantomMirror.settings',
    },
  ),
);
