# 00. Capacitor native shell: setup notes

Arcadian ships to iOS and Android by wrapping the existing web build in
Capacitor 8.6.2. The native apps load the same `dist/` that GitHub Pages serves at
arcadian.ltd. Nothing about the web deploy changed. The short version lives in
AGENTS.md §3, "Native shell (Capacitor)". This file is the longer one.

## What is in the repo

| Path | What it is |
|---|---|
| `capacitor.config.ts` | App id `ltd.arcadian.app`, name `Arcadian`, `webDir: 'dist'`, the two webview schemes. |
| `ios/` | Xcode project on **CocoaPods** (`ios/App/Podfile`; open `ios/App/App.xcworkspace`, not the `.xcodeproj`). Deployment target **iOS 15.5**, in the Podfile (`platform :ios, '15.5'`) and in every `IPHONEOS_DEPLOYMENT_TARGET` in `ios/App/App.xcodeproj/project.pbxproj`. See "Why CocoaPods" below. |
| `android/` | Gradle project. `minSdk 24`, `compileSdk`/`targetSdk 36`. |
| `src/lib/platform.ts` | `isNative()`, `platform()`, `nativeOrigin`, `NATIVE_ORIGINS`. The only place app code should ask which shell it is in. |
| `src/lib/native/` | One adapter per native capability: `speech.ts`, `barcode.ts`, `photos.ts`, plus `nativePlugin.ts` (`hasNativePlugin(name)`). Each has a web path that is the pre-Capacitor code. |
| `src/lib/supabase.ts` | On native only, the auth session is stored through `@capacitor/preferences`. |
| `src/main.tsx` | On native only, the service worker is not registered. |
| `src/components/step2TouchDrag.ts` | Step 2 long-press touch drag. Not native-specific (it also serves phone browsers), but it is what makes Step 2 usable in the app. |

### Why CocoaPods

The iOS project was first generated on Swift Package Manager. `cap sync` then
skipped `@capacitor-community/speech-recognition` and
`@capacitor-mlkit/barcode-scanning` ("does not have a Package.swift"): both ship
only podspecs, and Google ML Kit will never be distributed through SPM. A skipped
plugin is not an error at build time, it is "not implemented" on every call at
run time. The project was regenerated with:

```bash
npx cap add ios --packagemanager CocoaPods
```

Do not regenerate it on SPM. If the deployment target ever moves, change the
Podfile and the pbxproj together, and never below 15.5 (ML Kit's floor).

npm scripts:

- `npm run cap:sync`: `npm run build`, then `cap sync` (copies `dist/` into both native projects and updates native plugin wiring, including the plugin pods in `ios/App/Podfile`).
- `npm run cap:ios`: opens the iOS project in Xcode (the `App.xcworkspace`, since the project uses CocoaPods).
- `npm run cap:android`: opens `android/` in Android Studio.

## Prerequisites

Checked on the dev Mac on 22 Nov 2026:

| Tool | Needed for | Status then |
|---|---|---|
| Node 22+ | Capacitor CLI 8 | present (22.19) |
| Xcode (full app, not only the command line tools) | `pod install`, building and running iOS | present (Xcode 27.2, 22 Nov 2026). Set `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` or run `sudo xcode-select -s` once so the CLI uses it |
| CocoaPods | `pod install` for the iOS project | present (`/opt/homebrew/bin/pod`); `pod install` passed with 25 pods |
| Android Studio, Android SDK (`$ANDROID_HOME`) | building and running Android | Android Studio installed via Homebrew; **SDK missing until its first-run wizard is completed** (`~/.zshrc` already exports `ANDROID_HOME` once the folder exists) |
| JDK | Gradle for Capacitor 8 | present: Android Studio's bundled JBR (OpenJDK 25), exported as `JAVA_HOME` by `~/.zshrc` |

iOS compiles: `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -sdk iphonesimulator build` succeeded on 22 Nov 2026 with every plugin linked. **It cannot run on an Apple Silicon simulator while ML Kit is linked:** the GoogleMLKit and MLImage pods set `EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64` (Google ships no arm64 simulator slice), so the simulator build is x86_64 only, and iOS 27 simulators refuse both x86_64 apps and Rosetta boots (`simctl boot --arch=x86_64` answers "not one of the device's supported architectures"). Test on a real iPhone: plug it in, pick it as the run destination in Xcode, set a Team under Signing (a free personal team works for development), and press Run. If simulator testing is ever needed, add a Podfile switch that skips the ML Kit pod for simulator-only installs; the app already falls back to the web barcode path when the plugin is absent. Nothing Android has been built.

To finish the setup:

```bash
# iOS: install Xcode from the App Store, then
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -downloadPlatform iOS        # simulator runtime, if Xcode did not fetch one

# Android: install Android Studio (it bundles a JDK 21), open it once to install
# the SDK, then in ~/.zshrc
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

Both native projects were already generated with `cap add`, so none of this has
to be re-run; it is only needed to build.

## First run

1. `.env` must hold the Supabase variables, exactly as for the web build (AGENTS.md §4). They are inlined into the bundle that `cap sync` copies, so the native app talks to the same project.
2. `npm install`
3. `npm run cap:sync`
4. iOS only: `cd ios/App && pod install` (needs full Xcode selected; re-run it after any `cap sync` that adds or removes a plugin). `ios/App/Pods` and `Podfile.lock` are already in the tree from generation, but treat them as unverified until a `pod install` has succeeded with Xcode present.
5. iOS: `npm run cap:ios`, pick a simulator or a plugged-in device, press Run. A device needs a development team selected under Signing and Capabilities. ML Kit's pods do not support every simulator architecture on Apple Silicon; if the simulator build fails on them, use a device.
6. Android: `npm run cap:android`, let Gradle sync, pick an emulator or a USB-debugging device, press Run. The emulator needs a Google Play system image for the ML Kit scanner module.

Every web change needs `npm run cap:sync` again before it shows up in the apps.
Live reload (`server.url` pointing at the Vite dev server) is not configured; if
you add it for local work, never commit it, because it makes the app load from
that URL instead of the bundled files.

## Origins

| Shell | Origin | Why |
|---|---|---|
| Web | `https://arcadian.ltd` | GitHub Pages custom domain |
| iOS | `capacitor://localhost` | `server.iosScheme: 'capacitor'`, the default |
| Android | `https://localhost` | `server.androidScheme: 'https'`, the Capacitor 8 default |

- **CSP (`index.html`):** no change needed. `'self'` resolves to the webview's own origin, so the bundled script, styles, images and fonts still match, and Supabase and the matting service are named by absolute `https:`/`wss:` origins that do not depend on the page origin.
- **Matting service:** `capacitor://localhost` and `https://localhost` are in the default `ALLOWED_ORIGINS` (bare `http://localhost` is deliberately refused) (`services/matting/app/config.py`, CONTRACT.md §3, `tests/test_cors.py`), and in `fly.toml.example` and `deploy.sh`. **The running Fly service still has the old two-origin list** (`ALLOWED_ORIGINS` is a Fly secret, set by the previous `deploy. The 22 Nov 2026 redeploy attempt failed because the Fly.io trial has ended (every API call asks for a credit card at https://fly.io/trial) and the service is currently not answering at all, on the web too. After billing is restored, run `REPLICATE_VERSION=<value from services/matting/fly.toml> services/matting/deploy.sh` so the pinned model version is kept.sh`), so photo backgrounds and Find similar fail CORS in the native apps until `services/matting/deploy.sh` is run again. The web is unaffected either way.
- **Supabase auth:** email and password sign-in needs no redirect URL. If a magic link or OAuth flow is ever added, the native app will need a deep link scheme and an entry in the Supabase redirect allowlist; that is not set up.

## What behaves differently on native

- **Service worker:** not registered. Service workers do not run in WKWebView, so the image cache in `public/sw.js` is web only. `sw.js` itself is unchanged.
- **Auth session:** stored with `@capacitor/preferences` (iOS UserDefaults, Android SharedPreferences) under the same supabase-js key. That is app-private storage that the OS will not clear along with webview data. It is not encrypted; a Keychain or Keystore backed store would be a separate dependency decision.
- **Step 1 photos:** Take photos and Choose from library open `@capacitor/camera` (`src/lib/native/photos.ts`). `null` from the adapter means "no native picker, click the input"; `[]` means the user cancelled. `File.lastModified` is set to the capture time, because the plugin's re-encode can drop EXIF.
- **Step 2:** long press drags on touch (`step2TouchDrag.ts`); select then tap a category still works. Same in a phone browser. With the dock's search focused, the Keyboard plugin shrinks the webview, so the dock sits on top of the keyboard and the tab bar is hidden (a phone browser gets the same result from `visualViewport`, AGENTS.md §10 Step 2).
- **Step 3 dictation:** `@capacitor-community/speech-recognition` through `createSpeechRecognizer` (`src/lib/native/speech.ts`). The native recogniser stops after every pause, so PDG restarts it; a session that ends within 1 s having heard nothing backs the restart off 600 / 1200 / 2400 / 4800 ms (capped at 5 s), and the fifth such end in a row stops dictation. The adapter also guards against the Android plugin itself: `stop()` is never awaited (the plugin never resolves it), a 12 s idle watchdog ends a silent session, a 300 ms settle window lets the trailing final result land, and start failures surface as `onError` with browser-style codes.
- **Scan:** Google ML Kit's full-screen scanner (`src/lib/native/barcode.ts`). Android first installs the Google code scanner module from Play services if it is missing (no camera permission needed); iOS asks for the camera permission. A scan whose webview Android killed comes back as `@capacitor/app`'s `appRestoredResult`, which the Scan view listens for.
- **Everything else** is the web app. The `sortbot_*` localStorage keys (AGENTS.md §1) live in the webview's localStorage as they do in a browser.

## The rule for native features

Every feature must keep working on the web, and native code is reached only
behind `isNative()` / `hasNativePlugin()` with a dynamic import. In a browser the
plugins are either missing or fall back to a web stub, so:

- put the capability in an adapter in `src/lib/native/` and call that from the component;
- take the native path only when `hasNativePlugin('<PluginName>')` is true (`isNative()` alone does not prove the plugin is linked into this build);
- load the plugin with `import('...')` inside the native branch, so the web bundle does not carry it;
- keep the existing web code path as the default branch;
- never let a web feature wait on a plugin call that can only succeed on a device.

## Plugins

| Plugin | Version | Why |
|---|---|---|
| `@capacitor/core` | 8.6.2 | Runtime and `isNativePlatform()` / `getPlatform()` |
| `@capacitor/cli` (dev) | 8.6.2 | `cap sync`, `cap open` |
| `@capacitor/ios`, `@capacitor/android` | 8.6.2 | The two platforms |
| `@capacitor/app` | 8.1.2 | The `appRestoredResult` listener in the Scan view (wired up); lifecycle, Android back button and deep links later |
| `@capacitor/preferences` | 8.0.1 | Auth session storage on native (wired up) |
| `@capacitor/camera` | 8.2.6 | Step 1 Take photos / Choose from library (wired up, `src/lib/native/photos.ts`) |
| `@capacitor-community/speech-recognition` | 7.0.1 | Step 3 dictation, because the webview's `SpeechRecognition` is not reliable (wired up, `src/lib/native/speech.ts`). Podspec only. |
| `@capacitor-mlkit/barcode-scanning` | 8.2.2 | Scan view camera scanning with Google ML Kit, because the webview has no `BarcodeDetector` (wired up, `src/lib/native/barcode.ts`). Podspec only; ML Kit needs iOS 15.5. |
| `@capacitor/filesystem` | 8.1.5 | Write CSV and ZIP exports to device storage |
| `@capacitor/share` | 8.0.3 | Hand an export to the system share sheet |
| `@capacitor/browser` | 8.0.5 | Open external links in an in-app browser |
| `@capacitor/status-bar` | 8.0.4 | Match the status bar to the light theme |
| `@capacitor/splash-screen` | 8.0.2 | Control when the launch screen hides |
| `@capacitor/keyboard` | 8.0.6 | Step 2's category dock rises above the on-screen keyboard while its search is focused (wired up, `src/lib/native/keyboard.ts`). Config `plugins.Keyboard`: `resize: 'native'` (iOS, resizes the webview frame; `'body'` would not move a sticky-bottom dock because the document, not the body, scrolls) and `resizeOnFullScreen: true` (Android full-screen workaround). `initKeyboard()` in `main.tsx` re-shows the iOS accessory bar the plugin hides. No permissions. |

Used by app code: `preferences`, `camera`, `app`, `keyboard`, speech recognition and barcode
scanning. Installed and unused: `filesystem`, `share`, `browser`, `status-bar`,
`splash-screen`.

Permissions:

- **iOS** (`ios/App/App/Info.plist`): `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`. A missing usage string crashes the app the first time the feature is used.
- **Android** (`android/app/src/main/AndroidManifest.xml`): `android:allowBackup="false"` so the preferences file that holds the Supabase refresh token is excluded from Google Drive auto-backup and `adb backup`; permissions `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, and the `com.google.mlkit.vision.DEPENDENCIES` meta-data set to `barcode_ui`, which has Play services fetch the Google code scanner module at install time (the app also installs it on demand). No media-read permission is declared, because the gallery goes through the system Photo Picker and Google Play restricts `READ_MEDIA_IMAGES`.
- **`@capacitor/keyboard` needs none** on either platform: no usage string, no manifest permission, and its README documents no plist or manifest entry.

## Icons and splash screens

The Capacitor placeholder art was replaced on 22 Nov 2026 with the "A" mark from
`public/favicon.svg` (the white glyph on that favicon's black tile, drawn on its own).

**Sources** live in `assets/` at the repo root, which is the folder
`@capacitor/assets` (a devDependency, approved) reads:

| File | Size | What it is |
|---|---|---|
| `icon-only.png` | 1024x1024 | Black mark on opaque white, mark 56% of the tile. iOS icon and the legacy Android icons. |
| `icon-foreground.png` | 1024x1024 | Android adaptive foreground: black mark on transparent, 50% of the layer. The generated `mipmap-anydpi-v26/ic_launcher*.xml` insets each layer by 16.7%, so the layer is the visible icon and the mark clears a circular mask. |
| `icon-background.png` | 1024x1024 | Android adaptive background: plain white. |
| `splash.png` | 2732x2732 | White, black mark at 20% of the width. |
| `splash-dark.png` | 2732x2732 | Black, white mark at 20% of the width. Used in dark mode. |

`assets/make-sources.mjs` draws all five from the favicon's path with sharp, so
they are reproducible: change the favicon, then regenerate.

**Regenerate** from the repo root:

```bash
node assets/make-sources.mjs   # favicon.svg -> assets/*.png
npm run assets:generate        # assets/*.png -> every iOS and Android size
git checkout -- android/app/src/main/AndroidManifest.xml
```

The last line matters: the generator re-serialises `AndroidManifest.xml` (same
content, collapsed whitespace and comments moved), which is noise in a diff.

**Colours**, passed explicitly in the `assets:generate` script: icon and splash
background `#ffffff`, dark-mode icon and splash background `#000000`. These are
`--ink-950` and `--accent` from `src/index.css`; the mark is pure black on light
and pure white on dark.

**Outputs:**

- **iOS app icon:** `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`, a single opaque 1024x1024 entry in `Contents.json` (the Xcode 14+ single-size format; Xcode derives every other size).
- **iOS splash:** `Splash.imageset/Default@{1,2,3}x~universal~anyany.png` plus `-dark` variants (all 2732x2732), with a `luminosity: dark` appearance in `Contents.json`. The launch screen is Capacitor's `ios/App/App/Base.lproj/LaunchScreen.storyboard`, an image view showing the `Splash` image aspect-fill; it was not edited.
- **Android icon:** `mipmap-{ldpi..xxxhdpi}/ic_launcher.png`, `ic_launcher_round.png`, `ic_launcher_foreground.png`, `ic_launcher_background.png`, and the adaptive XML in `mipmap-anydpi-v26/`. The old vector placeholders (`drawable/ic_launcher_background.xml`, `drawable-v24/ic_launcher_foreground.xml`) were deleted; nothing referenced them.
- **Android splash:** `drawable/splash.png`, `drawable-{port,land}-{ldpi..xxxhdpi}/splash.png`, and the dark set in `drawable-night/` and `drawable-{port,land}-night-*`.

The `@capacitor/status-bar` and `@capacitor/splash-screen` plugins are already
installed but not configured or called: today the splash hides on Capacitor's
default timing and the status bar keeps the platform default style.

## To do (needs a person)

1. **Install Xcode** from the App Store (CocoaPods is already installed via Homebrew; Android Studio is installed too), then `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` and `sudo xcodebuild -license accept`. Then `cd ios/App && pod install`, and build once on a device.
2. **Open Android Studio once** so its first-run wizard installs the SDK and you accept the SDK licenses. `~/.zshrc` already exports `ANDROID_HOME`, `platform-tools` on `PATH` and `JAVA_HOME` (Android Studio's bundled JDK), guarded so they activate once the SDK folder exists. Then build once on a device or a Play system-image emulator.
3. **Restore Fly.io billing, then redeploy the matting service.** The 22 Nov 2026 attempt failed because the Fly trial has ended (add a card at https://fly.io/trial) and the service is not answering at all right now. Then run `REPLICATE_VERSION=<value from services/matting/fly.toml> services/matting/deploy.sh` so the pinned model is kept.
4. ~~Replace the placeholder icons and splash screens~~ Done 22 Nov 2026 (see "Icons and splash screens" above). Swap the mark later by editing `public/favicon.svg` and regenerating.
5. **Try every Known gap below on a real device** and decide which to fix; none of them has been seen yet.

## Known gaps

Recorded by the builders of this pass. None has been reproduced on a device,
because no device build exists yet.

- **A restored scan only lands if the user opens the Scan view.** When Android kills the webview while ML Kit's scanner is open, the result comes back as `appRestoredResult`. Capacitor holds that event until a listener exists, and only `BarcodeScannerView` listens, so the app reopening on Home does not show the scan until the Scan view is opened.
- **Restored photos are dropped.** The same Android restore can happen while the Camera plugin is open in Step 1. Nothing listens for the Camera plugin's `appRestoredResult`, so that photo is lost and has to be taken again.
- **Native "Take photos" is one photo per tap.** The plugin's `takePhoto` has no multi-shot mode; the web input (`capture` + `multiple`) is unchanged.
- **The native final transcript can land after auto-extract.** On native, the last hypothesis becomes the final result when the session ends, which can be after Stop's 150 ms auto-extract timer has read the transcript. The words are kept; that one extraction pass misses them.
- **The restart backoff numbers are untuned.** 1 s for a "quick end", 600 / 1200 / 2400 / 4800 ms capped at 5 s, give up after five in a row (`ProductDescriptionGenerator.tsx`, `NATIVE_*` constants). Chosen without a device.
- **"Please use Chrome or Edge" reads oddly in the app.** When the speech plugin is missing or the device has no recogniser, Step 3 shows the browser wording.
- **No haptics on iOS.** Step 2's pickup calls `navigator.vibrate`, which WebKit does not implement, and no haptics plugin is installed. Android vibrates.
- **Some header comments still describe the SPM project.** `src/lib/native/nativePlugin.ts`, `speech.ts`, `barcode.ts` and `BarcodeScannerView.tsx` say the community plugins are not linked on iOS. That was true before the CocoaPods regeneration; with CocoaPods both are expected to link once `pod install` runs.

## Out of scope

Release signing (iOS certificates and provisioning profiles, the Android upload
keystore), App Store Connect and Play Console listings, and CI builds of the
native apps. Signing files are gitignored at the repo root (`*.jks`,
`*.keystore`, `*.p12`, `*.mobileprovision`, `android/keystore.properties`); keep
it that way.
