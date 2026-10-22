import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: false,
  load: vi.fn(),
  register: vi.fn(),
  available: vi.fn<() => Promise<{ available: boolean }>>(),
  decode: vi.fn<(options: { audio: string }) => Promise<{ wav: string }>>(),
  timing: vi.fn<(bytes: ArrayBuffer) => ArrayBuffer>(),
}));
vi.mock('../src/platform/nativeHost.js', () => ({ isNativeHost: () => mocks.native }));
vi.mock('../src/platform/nativeAudioTiming.js', () => ({ nativeAudioTiming: mocks.timing }));
vi.mock('@capacitor/core', () => {
  mocks.load();
  return { registerPlugin: mocks.register };
});

const decoded: AudioBuffer = {
  duration: 1, length: 4, numberOfChannels: 1, sampleRate: 4,
  getChannelData: () => new Float32Array(4),
  copyFromChannel: () => {}, copyToChannel: () => {},
};
const context = { decodeAudioData: vi.fn<BaseAudioContext['decodeAudioData']>() };
let decodeAudioData: typeof import('../src/platform/audioDecode.js')['decodeAudioData'];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.native = false;
  mocks.timing.mockReset().mockImplementation(bytes => bytes);
  mocks.available.mockReset().mockResolvedValue({ available: false });
  mocks.decode.mockReset().mockResolvedValue({ wav: 'UklGRg==' });
  mocks.register.mockReset().mockReturnValue({ isAvailable: mocks.available, decode: mocks.decode });
  context.decodeAudioData.mockReset().mockResolvedValue(decoded);
  ({ decodeAudioData } = await import('../src/platform/audioDecode.js'));
});

describe('platform audio decoding', () => {
  it('keeps the web decoder and bytes unchanged without loading Capacitor', async () => {
    const bytes = new Uint8Array([0, 1, 255]).buffer;
    expect(await decodeAudioData(context, bytes)).toBe(decoded);
    expect(context.decodeAudioData).toHaveBeenCalledExactlyOnceWith(bytes);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.timing).not.toHaveBeenCalled();
  });

  it('checks the native platform once across concurrent sounds but leaves iPhone/iPad decoding alone', async () => {
    mocks.native = true;
    const bytes = [new Uint8Array([1]).buffer, new Uint8Array([2]).buffer];
    await Promise.all(bytes.map(body => decodeAudioData(context, body)));
    expect(mocks.available).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith('AudioDecode');
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.timing).not.toHaveBeenCalled();
    expect(context.decodeAudioData.mock.calls.map(call => call[0])).toEqual(bytes);
  });

  it('sends exact binary AAC bytes on Mac, including inputs larger than the argument-list limit', async () => {
    mocks.native = true;
    mocks.available.mockResolvedValue({ available: true });
    const bytes = Uint8Array.from({ length: 300_000 }, (_, i) => i % 256);
    expect(await decodeAudioData(context, bytes.buffer)).toBe(decoded);
    expect(mocks.timing).toHaveBeenCalledExactlyOnceWith(bytes.buffer);
    expect(Buffer.from(mocks.decode.mock.calls[0]![0].audio, 'base64')).toEqual(Buffer.from(bytes));
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(context.decodeAudioData.mock.calls[0]![0])).toEqual(new Uint8Array([82, 73, 70, 70]));
    expect(bytes[255]).toBe(255);
  });

  it('does not share one sound result with another concurrent sound', async () => {
    mocks.native = true;
    mocks.available.mockResolvedValue({ available: true });
    mocks.decode.mockImplementation(async ({ audio }) => ({ wav: audio }));
    const bytes = [new Uint8Array([1, 2]).buffer, new Uint8Array([3, 4]).buffer];
    await Promise.all(bytes.map(body => decodeAudioData(context, body)));
    expect(mocks.available).toHaveBeenCalledTimes(1);
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    expect(context.decodeAudioData.mock.calls.map(call => new Uint8Array(call[0])))
      .toEqual(bytes.map(body => new Uint8Array(body)));
  });

  it('passes sample-accurate timing to native decoding without changing the caller bytes', async () => {
    mocks.native = true;
    mocks.available.mockResolvedValue({ available: true });
    const bytes = new Uint8Array([1, 2]).buffer;
    mocks.timing.mockReturnValue(new Uint8Array([3, 4]).buffer);
    await decodeAudioData(context, bytes);
    expect(mocks.decode).toHaveBeenCalledExactlyOnceWith({ audio: 'AwQ=' });
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2]));
  });

  it('propagates unsupported native input without invoking the decoder', async () => {
    mocks.native = true;
    mocks.available.mockResolvedValue({ available: true });
    mocks.timing.mockImplementation(() => { throw new Error('invalid timing'); });
    await expect(decodeAudioData(context, new ArrayBuffer(1))).rejects.toThrow('invalid timing');
    expect(mocks.decode).not.toHaveBeenCalled();
  });

  it('does not let Promise resolution treat the Capacitor proxy as a thenable', async () => {
    mocks.native = true;
    mocks.available.mockResolvedValue({ available: true });
    mocks.register.mockReturnValue(new Proxy({ isAvailable: mocks.available, decode: mocks.decode }, {
      get(target, key, receiver) {
        if (key === 'then') throw new Error('AudioDecode.then() is not implemented');
        return Reflect.get(target, key, receiver);
      },
    }));
    expect(await decodeAudioData(context, new ArrayBuffer(1))).toBe(decoded);
  });

  it('propagates a platform-check failure rather than pretending the unsupported decoder worked', async () => {
    mocks.native = true;
    mocks.available.mockRejectedValue(new Error('bridge unavailable'));
    await expect(decodeAudioData(context, new ArrayBuffer(1))).rejects.toThrow('bridge unavailable');
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });

  it('propagates native decode errors instead of returning silent audio', async () => {
    mocks.native = true;
    mocks.available.mockResolvedValue({ available: true });
    mocks.decode.mockRejectedValue(new Error('invalid audio'));
    await expect(decodeAudioData(context, new ArrayBuffer(1))).rejects.toThrow('invalid audio');
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });

  it('rejects a malformed native response', async () => {
    mocks.native = true;
    mocks.available.mockResolvedValue({ available: true });
    mocks.decode.mockResolvedValue({ wav: 'not base64!' });
    await expect(decodeAudioData(context, new ArrayBuffer(1))).rejects.toThrow();
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });

  it('propagates PCM parsing failures from Web Audio', async () => {
    mocks.native = true;
    mocks.available.mockResolvedValue({ available: true });
    context.decodeAudioData.mockRejectedValue(new Error('bad PCM'));
    await expect(decodeAudioData(context, new ArrayBuffer(1))).rejects.toThrow('bad PCM');
  });

  it('registers and builds the native plugin, with availability scoped to iOS-on-Mac', () => {
    const plugin = readFileSync('ios/App/App/AudioDecodePlugin.swift', 'utf8');
    const controller = readFileSync('ios/App/App/SafeAreaBridgeViewController.swift', 'utf8');
    const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
    expect(plugin).toContain('call.resolve(["available": ProcessInfo.processInfo.isiOSAppOnMac])');
    expect(plugin).toContain('guard ProcessInfo.processInfo.isiOSAppOnMac else');
    expect(controller).toContain('bridge?.registerPluginInstance(AudioDecodePlugin())');
    expect(project.match(/AudioDecodePlugin\.swift in Sources/g)).toHaveLength(2);
  });
});
