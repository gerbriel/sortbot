import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor native shell for Arcadian (iOS + Android). The native apps load the
// same `npm run build` output (dist/) that GitHub Pages serves; nothing here
// changes the web deploy. See AGENTS.md "Native shell (Capacitor)" and
// docs/mobile/00-capacitor.md.
//
// Webview origins this config produces (they must stay in the matting
// service's ALLOWED_ORIGINS, services/matting/CONTRACT.md §3):
//   iOS      capacitor://localhost   (iosScheme 'capacitor', the default)
//   Android  https://localhost       (androidScheme 'https', the Capacitor 8 default)
const config: CapacitorConfig = {
  appId: 'ltd.arcadian.app',
  appName: 'Arcadian',
  webDir: 'dist',
  server: {
    // Both are the Capacitor 8 defaults, written out so the origins above are
    // visible in one place and a future CLI default change cannot move them.
    iosScheme: 'capacitor',
    androidScheme: 'https',
  },
};

export default config;
