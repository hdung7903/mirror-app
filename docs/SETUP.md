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

You can download the pinned server with:

```bash
node tools/scripts/download-scrcpy-server.mjs
```

Then press Mirror on an Android device. The backend will push the server, forward a local TCP port, start the server process, open a local WebSocket bridge, and let the frontend WebCodecs decoder render the H.264 stream.

## Testing Stream

1. Connect an Android phone or tablet and enable USB Debugging.
2. Verify ADB authorization:

```bash
adb devices -l
```

3. Run the app and click Mirror on the target device.
4. Open DevTools Console and inspect WebCodecs or stream bridge errors.
5. Use the WebSocket port returned by `start_stream_bridge` to debug the stream:

```bash
node tools/scripts/test-stream.mjs {wsPort}
```

Example:

```bash
node tools/scripts/test-stream.mjs 27184
```

The script receives stream metadata, counts binary video frames for 5 seconds, prints FPS, average frame size, total received bytes, and saves the first raw H.264 NAL payload to `first-frame.h264`.

## Android Extended Display

The extended-display path streams PC content to an Android phone or tablet, the reverse direction of mirroring.

1. Build and install the Android agent from `apps/android-agent`.

```bash
cd apps/android-agent
gradle assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

If `gradle` is not installed, open `apps/android-agent` in Android Studio and build the `app` module.

2. In PhantomMirror, choose an Android device and click `Extended`.
3. Enter the PC LAN IP shown to the Android device. PhantomMirror opens a secondary window and shows a WebSocket URL like:

```text
ws://192.168.1.10:39877
```

4. Open PhantomMirror Agent on Android, enter that URL, and tap Connect.
5. Drag the secondary window to the monitor or workspace you want to stream.

Touch events from Android are sent back as normalized coordinates and emitted through the Tauri `ext-touch` event. The current desktop implementation streams the secondary window canvas via WebCodecs H.264; arbitrary OS window capture is a later integration point.

## iOS AirPlay

iOS mirroring uses a bundled headless UxPlay runtime and renders inside PhantomMirror.

```bash
node tools/scripts/download-uxplay-prebuilt.mjs
```

If no prebuilt exists for your OS/architecture, build it:

```bash
bash tools/scripts/build-uxplay.sh
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File tools/scripts/build-uxplay.ps1
```

Then open the iOS tab, choose quality, click `Start AirPlay Receiver`, and on iPhone choose PhantomMirror from Control Center -> Screen Mirroring.

See `docs/IOS_SETUP.md` for network and firewall details.

## Current limitations

- Android touch while mirroring is relayed through the scrcpy control socket. ADB shell input remains available as a fallback service.
- iOS AirPlay is view-only. H.265/4K depends on WebCodecs HEVC support in the desktop WebView.
- Android extended display requires the companion Android agent from `apps/android-agent`.
