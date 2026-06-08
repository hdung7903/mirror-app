# PhantomMirror

PhantomMirror is a desktop app for mirroring and controlling multiple Android devices from a laptop or PC. The first implementation focuses on the desktop shell, multi-device layout, Android device discovery through ADB, and basic tap/swipe input injection.

## Current scope

- Tauri v2 desktop app with React and TypeScript.
- Multi-device dashboard with grid, focus, and single-device layouts.
- ADB device scanning from the Rust backend.
- Android tap and swipe commands through `adb shell input`.
- WiFi ADB connection helper.
- Placeholder stream canvas ready for the H.264/WebCodecs pipeline.

## Requirements

- Node.js 20+
- Rust stable
- Android Platform Tools available on `PATH` as `adb`
- Windows WebView2 runtime for Tauri

## Development

```bash
npm install
npm run dev
```

For the full Tauri desktop shell:

```bash
npm run tauri dev --workspace @phantommirror/desktop
```

Connect an Android device with USB debugging enabled, then use the Scan button in the app. iOS mirroring and Android extended display are documented in `MIRROR_APP_PROJECT.md` and remain later phases.
