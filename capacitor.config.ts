import type { CapacitorConfig } from '@capacitor/cli';
// Type-only: brings in the plugin's PluginsConfig augmentation for `plugins.Keyboard`.
import type { KeyboardResize } from '@capacitor/keyboard';

// Capacitor native shell for the app (iOS + Android). appName is written from
// brand.json by `npm run brand:apply`; appId is an identifier and never changes.
// The native apps load the same `npm run build` output (dist/) that GitHub Pages serves; nothing here
// changes the web deploy. See AGENTS.md "Native shell (Capacitor)" and
// docs/mobile/00-capacitor.md.
//
// Webview origins this config produces (they must stay in the matting
// service's ALLOWED_ORIGINS, services/matting/CONTRACT.md §3):
//   iOS      capacitor://localhost   (iosScheme 'capacitor', the default)
//   Android  https://localhost       (androidScheme 'https', the Capacitor 8 default)
const config: CapacitorConfig = {
  appId: 'ltd.arcadian.app',
  appName: 'SQRL',
  webDir: 'dist',
  server: {
    // Both are the Capacitor 8 defaults, written out so the origins above are
    // visible in one place and a future CLI default change cannot move them.
    iosScheme: 'capacitor',
    androidScheme: 'https',
  },
  plugins: {
    // @capacitor/keyboard (src/lib/native/keyboard.ts). Step 2's category dock is
    // sticky to the bottom and must sit above the keyboard while its search is
    // focused (AGENTS.md §10 Step 2, "The dock and the keyboard").
    Keyboard: {
      // iOS: 'native' resizes the WEBVIEW FRAME, so the layout viewport ends at
      // the top of the keyboard and every sticky or fixed bottom surface rises
      // with it. Not 'body': that mode only sets document.body's height, and
      // this page scrolls the document, not the body, so a sticky-bottom dock
      // would stay pinned to the full-height viewport behind the keyboard. The
      // plugin also detaches WKWebView's own keyboard handling, so nothing else
      // would move it.
      resize: 'native' as KeyboardResize.Native,
      // Android: the plugin's documented workaround for a webview that does not
      // resize while the app draws full screen (edge to edge, status bar
      // overlaid), which is how this shell runs.
      resizeOnFullScreen: true,
    },
  },
};

export default config;
