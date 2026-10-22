import { isNativeHost } from './nativeHost.js';
import { nativeAudioTiming } from './nativeAudioTiming.js';

interface AudioDecodePlugin {
  isAvailable(): Promise<{ available: boolean }>;
  decode(options: { audio: string }): Promise<{ wav: string }>;
}

let nativeDecoder: Promise<{ plugin: AudioDecodePlugin } | null> | null = null;

function decoder(): Promise<{ plugin: AudioDecodePlugin } | null> {
  return nativeDecoder ??= (async () => {
    const { registerPlugin } = await import('@capacitor/core');
    const plugin = registerPlugin<AudioDecodePlugin>('AudioDecode');
    // Capacitor proxies synthesize every property, including "then"; never resolve
    // a Promise directly with a plugin or it tries to invoke a native then() method.
    return (await plugin.isAvailable()).available ? { plugin } : null;
  })();
}

function base64(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 8192) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

/**
 * iOS-on-Mac's WebView can reject every compressed codec while native AVAudioFile
 * decodes the same bytes. Only that host uses the bridge; browsers never load it.
 * The bridge returns lossless float PCM WAV. Web Audio still does the resampling,
 * so voice trimming, mixer clocks and music loop points keep their existing units.
 */
export async function decodeAudioData(
  context: Pick<BaseAudioContext, 'decodeAudioData'>,
  bytes: ArrayBuffer,
): Promise<AudioBuffer> {
  const native = isNativeHost() ? await decoder() : null;
  if (!native) return context.decodeAudioData(bytes);
  const { wav } = await native.plugin.decode({ audio: base64(nativeAudioTiming(bytes)) });
  const pcm = Uint8Array.from(atob(wav), char => char.charCodeAt(0));
  return context.decodeAudioData(pcm.buffer);
}
