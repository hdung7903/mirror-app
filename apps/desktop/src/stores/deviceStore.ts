import { create } from 'zustand';
import type { Device, LayoutMode } from '../types';
import * as adb from '../services/adb.service';

type DeviceStore = {
  devices: Device[];
  selectedId?: string;
  layout: LayoutMode;
  busy: boolean;
  notice?: string;
  scan: () => Promise<void>;
  connectWifi: (address: string) => Promise<void>;
  startMirror: (id: string) => Promise<void>;
  select: (id: string) => void;
  setLayout: (layout: LayoutMode) => void;
  remove: (id: string) => void;
};

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: [],
  selectedId: undefined,
  layout: 'grid',
  busy: false,
  notice: undefined,

  async scan() {
    set({ busy: true, notice: undefined });
    try {
      const result = await adb.scanDevices();
      set({
        devices: result.devices,
        selectedId: result.devices[0]?.id,
        notice: result.message,
      });
    } catch (error) {
      set({ notice: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: false });
    }
  },

  async connectWifi(address) {
    set({ busy: true, notice: undefined });
    try {
      const result = await adb.connectWifiDevice(address);
      set({
        devices: result.devices,
        selectedId: result.devices[0]?.id,
        notice: result.message,
      });
    } catch (error) {
      set({ notice: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: false });
    }
  },

  async startMirror(id) {
    const device = get().devices.find((item) => item.id === id);
    if (!device || device.kind !== 'android') {
      return;
    }

    set((state) => ({
      devices: state.devices.map((item) =>
        item.id === id ? { ...item, status: 'connecting' } : item,
      ),
    }));

    try {
      const streamPort = await adb.startMirror(device.serial);
      set((state) => ({
        devices: state.devices.map((item) =>
          item.id === id ? { ...item, streamPort, status: 'streaming' } : item,
        ),
      }));
    } catch (error) {
      set((state) => ({
        notice: error instanceof Error ? error.message : String(error),
        devices: state.devices.map((item) =>
          item.id === id ? { ...item, status: 'error' } : item,
        ),
      }));
    }
  },

  select(id) {
    set({ selectedId: id });
  },

  setLayout(layout) {
    set({ layout });
  },

  remove(id) {
    set((state) => {
      const devices = state.devices.filter((item) => item.id !== id);
      return {
        devices,
        selectedId: state.selectedId === id ? devices[0]?.id : state.selectedId,
      };
    });
  },
}));
