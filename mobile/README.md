# Toph mobile

React Native app for Toph, built with [Expo](https://expo.dev) SDK 57, React Native 0.86, Expo Router, and TypeScript. It lives in `mobile/` beside the Next.js dashboard at the repository root and has its own `package.json` and `node_modules`.

The app is the worker-facing recording flow: record a voice note about field work (or write one), review and complete the log, and keep drafts on the device. The native recording feature follows the Figma typography and colors; the earlier web phone mockup has been removed. The app connects to the Vercel server using the shared farm accounts. See [mobile API setup](../docs/backend/mobile.md) for the required server deployment and configuration. Save log keeps a local copy before uploading; account details, photos, and submitted logs persist in PostgreSQL. Recording processing returns speech and structured review fields when the server OpenAI key is configured.

## Requirements

- Node 24 and npm, matching the repository's root package.
- iOS: Xcode with an iOS simulator runtime, plus CocoaPods (`pod` on your PATH).
- Android: Android Studio SDK at `~/Library/Android/sdk`, a JDK 17 or 21 on `JAVA_HOME`, `ANDROID_HOME` exported, and an emulator with an installed system image.
- Optional: an OpenAI API key for transcription (see below).

## Run it

Install dependencies once:

```bash
npm ci
```

Start the Metro dev server (leave it running):

```bash
npx expo start
```

Build and install the development app on a simulator or emulator. The first build takes several minutes; later builds are incremental. Rebuild whenever `app.json` plugins or native dependencies change.

```bash
npx expo run:ios --device "iPhone 17"
```

```bash
npx expo run:android
```

To run on your own iPhone, plug it in, trust the Mac, and build a Release app, which embeds the JavaScript so it works without Metro:

```bash
npx expo run:ios --configuration Release --device 00008150-00063CD914D9401C
```

Find the identifier with `xcrun xctrace list devices` (the last value in parentheses). Signing uses the Apple team in `app.json` (`ios.appleTeamId`); change it if you sign with a different account. A Debug build on a phone instead loads from Metro, so the phone must be on the same Wi-Fi as the Mac and `npx expo start` must be running, or the app shows "No script URL provided".

Each `run:` command generates a missing native project (`ios/` or `android/`), compiles it, installs it, and opens the app. Debug builds load JavaScript from Metro; Release builds embed it. If Metro is already running, pass `--no-bundler` so the command does not start a second one. When native projects already exist, run `npx expo prebuild --no-clean --no-install` after changing icons, splash configuration, or other `app.json` settings, then rebuild. In SDK 57, prebuild recreates native folders by default: **`--no-clean` is required to preserve existing native projects and build output**. Omit `--no-install` when native dependencies have changed and CocoaPods must be refreshed.

## Connect to the hosted server

The default API origin is `https://toph-rho.vercel.app`; a fresh checkout does not require
mobile secrets. `mobile/.env.example` documents the optional `EXPO_PUBLIC_TOPH_API_URL`
override. Never put database credentials or server API keys in an `EXPO_PUBLIC_*` variable.

After pushing the server changes and waiting for Vercel to show Ready, run
`npm run check:mobile-server` from the repository root. Reopen the updated phone app and tap
the avatar to switch accounts or edit the profile, photo, and defaults. Save log keeps a
device copy and syncs to the same PostgreSQL database the dashboard reads. A failed upload
stays in the library with a Sync log action. The combined audio limit is 3.8 MB per log.

Adding the photo picker requires rebuilding the phone app once. An already rebuilt Release
app needs only to be reopened after the server deploys; future server changes do not require
a native rebuild unless the app itself or its bundled configuration changes.

## App icon and launch screen

`assets/images/icon.svg` is the shared icon source: the header's lowercase Geist SemiBold **t**, converted to an outline on white. It has no font dependency or baked-in rounded corners. Run `npm run icons` after editing it. The generator uses the development-only `sharp` package to export:

- `assets/images/icon.png`: opaque 1024 × 1024 fallback icon.
- `assets/toph.icon/Assets/toph-t.svg`: the same outline in the iOS Icon Composer bundle, on a solid white background with glass effects and shadows disabled. It uses the app-specific asset name `toph`, replacing the starter's `expo` name. Build 2 introduces this new identity because an existing physical iPhone continued to show the blue starter icon during the OS launch animation after the artwork was replaced in place.
- `assets/images/android-icon-foreground.png` and `android-icon-monochrome.png`: transparent, padded artwork for Android's adaptive masks and themed icons. The normal background is white; Android controls colors when the user enables themed icons.
- `assets/images/favicon.png`: the Expo web preview icon.

The chosen launch screen stays white with the full `toph` wordmark. `expo-splash-screen` generates the OS launch resources from `assets/images/splash-toph.png` for both platforms, including dark device appearance. The root layout holds that native screen until fonts finish loading (or fail) and the first app layout is ready, then hides it without an artificial delay or a second JavaScript loading screen.

Apply asset/config changes to both local native projects and rebuild:

```bash
npm run icons
npx expo prebuild --no-clean --no-install
npx expo run:ios --configuration Release --no-bundler
# Or build Android:
npx expo run:android --variant release --no-bundler
```

An app already installed on a phone needs the new binary; Fast Refresh cannot update its native launch screen or launcher icon. Expo Go and development launchers may show their own loading UI, so verify a cold launch from the home screen using a Release build. See [Expo SDK 57 splash-screen documentation](https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/). If iOS still shows an old launch image after an in-place rebuild, first restart the phone/simulator to refresh its cached launch snapshot. Avoid uninstalling just to clear the cache, since local recordings and drafts live in the app's data directory.

## Transcription and form filling

Finishing a recording calls `POST /api/mobile/v1/transcriptions`. The server transcribes the
speech and returns a validated object containing field, activity, date, times, notes,
treatment and tags. The review form fills untouched fields with these suggestions. Missing
facts stay unknown; manual edits win, including when audio is appended. Check the result
before saving. A separate Save log request persists it to the shared PostgreSQL database.

The root/server environment needs `OPENAI_API_KEY`;
no key or transcription token belongs in the mobile bundle. If extraction fails after
speech succeeds, the transcript stays available and retry only extracts details. Cancel
retains the audio and completed text. See [backend setup and live tests](../docs/backend/transcription.md).

## Checks

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npx expo-doctor
```

Unit tests cover the pure helpers, draft and profile storage (against an in-memory file-system fake), transcription and mobile clients (against fake network transports), account switching, and photo editing. Screen tests cover loading actions, transcript placement, save errors, and preserving drafts while switching accounts. Native recording and playback still require device/simulator verification; mocked tests do not establish microphone or live OpenAI behavior.

## Project layout

- `app.json` is the Expo app config: name `Toph`, slug `toph-mobile`, URL scheme `toph`, iOS bundle identifier and Android package `com.toph.mobile`, the Apple team for signing, light UI only, microphone permission text, the launch screen (white with the `toph` wordmark from `assets/images/splash-toph.png`), and the config plugins for audio, sharing, and the date picker.
- `src/app/_layout.tsx` loads the Geist fonts and hosts a single-screen stack; `src/app/index.tsx` renders the recording workspace.
- `src/features/recording/RecordingWorkspace.tsx` holds the four screens (Record, Review log, Draft saved, Logs), the header, and the bottom navigation.
- `src/features/recording/AccountSheet.tsx` is the drag-to-dismiss account sheet with searchable account switching, name/role/contact editing, profile photos, and recording defaults.
- `src/features/recording/use-recorder.ts` wraps `expo-audio` recording with a status machine (idle, requesting, recording, paused, stopping, ready), a timer, and a rolling level meter.
- `src/features/recording/AudioReview.tsx` plays a recording back and shares the file through the system share sheet.
- `src/features/recording/fields.tsx` provides the labeled inputs, the option picker, and the native date and time pickers.
- `src/features/recording/local-drafts.ts` stores drafts as `drafts.json` plus copied audio files under the app document directory. `recording-profile.ts` retains compatibility with earlier device-only defaults. `mobile-accounts.ts` caches the last server roster and active account; the server remains authoritative for account edits. Synced drafts retain their verified server receipt and local audio.
- `src/features/recording/recording-utils.ts` holds formatting and validation helpers shared by the screens.
- `assets/fonts/` holds the Geist Regular, Medium, and SemiBold files (SIL Open Font License) copied from the web app's `geist` package.
- `ios/` and `android/` are generated by prebuild and are gitignored. `expo-env.d.ts` is generated by Metro on first start and is gitignored.

## Native behavior

- The app fills the device screen and uses the real safe areas.
- The live waveform is a rolling level history from the recorder's metering, because React Native has no frequency analyser.
- Recordings are AAC `.m4a` files. The download link is a share action so the file can be saved to Files or sent elsewhere.
- Selects and date/time inputs use a bottom-sheet option list and the platform's native pickers instead of browser controls.

## Machine-specific notes

- CocoaPods on Ruby 4 crashes with an `Encoding::CompatibilityError` unless the shell has a UTF-8 locale. If `pod install` fails during `run:ios`, export `LANG=en_US.UTF-8` first.
- `create-expo-app` 4.0 cannot parse `npm pack --json` output from npm 12 (npm changed the JSON shape). This only matters when scaffolding new Expo projects; running the app is unaffected.
- Prefer `npx expo prebuild --no-clean --no-install` for updating existing native projects. SDK 57 prebuild deletes and recreates those folders unless `--no-clean` is passed.
- The Android emulators on this machine target API 35 arm64 and need the `system-images;android-35;google_apis_playstore;arm64-v8a` package installed through `sdkmanager`.
- When the app is opened through the development-client deep link, Expo Router logs a harmless "state update on a component that hasn't mounted yet" warning in development. A normal launch does not.

## Shared visual styles

Edit `../shared/design/tokens.ts` for the common colors, spacing, radii, and typography.
`src/features/recording/styles.ts` maps those values into native styles, and the web app
uses the same source for its CSS variables. Both use the `@toph/design` import alias.
See [the design token guide](../docs/design-tokens.md) for examples and platform differences.
If Metro was already running before this configuration was added, restart it once so it
loads the new alias and shared-folder watcher. After that, token edits use Fast Refresh.
