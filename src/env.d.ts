/// <reference types="vite/client" />

// Build-time constants injected by Vite `define` (see vite.config.ts).
declare const __APP_VERSION__: string;
declare const __BUILD_HASH__: string;
declare const __BUILD_DATE__: string;

// Build env consumed by the platform layer (never by engine/game logic).
interface ImportMetaEnv {
  /** Cloudflare Web Analytics beacon token; when set, the cookieless beacon loads
   *  in a production build. Absent in dev and in token-less builds. */
  readonly VITE_CF_BEACON_TOKEN?: string;
}
