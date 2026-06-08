# PhantomMirror Setup

## Desktop

```bash
npm install
npm run dev
```

For the native shell:

```bash
npm run tauri dev --workspace @phantommirror/desktop
```

## Android device preparation

1. Enable Developer Options on the phone or tablet.
2. Enable USB Debugging.
3. Connect by USB and accept the device authorization prompt.
4. Verify with:

```bash
adb devices -l
```

## Real mirror stream preparation

The UI and ADB control commands are present. For the H.264 stream path, put a pinned scrcpy server build here:

```text
tools/scrcpy-server/scrcpy-server.jar
```

Then press Mirror on an Android device. The backend will push the server, forward a local TCP port, and start the server process. The frontend decoder class is in `apps/desktop/src/services/h264.decoder.ts`; the current canvas uses a placeholder until the scrcpy socket framing bridge is completed.

## Current limitations

- Android tap/swipe uses `adb shell input`, so drag move streaming is coarse but reliable.
- iOS is represented as a view-only placeholder; AirPlay/UxPlay is a later phase.
- Android extended display requires a companion Android agent and is not included in this MVP.
