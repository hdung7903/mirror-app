import { invoke } from '@tauri-apps/api/core';

const isTauri = () => Boolean('__TAURI_INTERNALS__' in window);

export async function startExtendedDisplay(width: number, height: number): Promise<number> {
  if (!isTauri()) {
    return 39877;
  }
  return invoke<number>('start_extended_display', { width, height });
}

export async function stopExtendedDisplay(port: number): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke('stop_extended_display', { port });
}

export async function openExtendedDisplayWindow(port: number, width: number, height: number): Promise<void> {
  if (!isTauri()) {
    window.open(`/?view=extended&port=${port}&width=${width}&height=${height}`, '_blank');
    return;
  }
  await invoke('open_extended_display_window', { port, width, height });
}
