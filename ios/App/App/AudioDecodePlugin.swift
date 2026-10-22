import AVFoundation
import Capacitor

@objc(AudioDecodePlugin)
public class AudioDecodePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioDecodePlugin"
    public let jsName = "AudioDecode"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "decode", returnType: CAPPluginReturnPromise)
    ]

    // Keep large music buffers off the UI thread and avoid overlapping native PCM copies.
    private let queue = DispatchQueue(label: "io.github.ff4e.audio-decode")

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": ProcessInfo.processInfo.isiOSAppOnMac])
    }

    @objc func decode(_ call: CAPPluginCall) {
        guard ProcessInfo.processInfo.isiOSAppOnMac else {
            call.reject("Native audio decoding is only needed for iOS apps running on Mac")
            return
        }
        guard let encoded = call.getString("audio"),
              let data = Data(base64Encoded: encoded), !data.isEmpty else {
            call.reject("AudioDecode requires nonempty base64 audio")
            return
        }
        queue.async {
            autoreleasepool {
                do {
                    let url = FileManager.default.temporaryDirectory
                        .appendingPathComponent("ff4e-audio-\(UUID().uuidString).m4a")
                    try data.write(to: url)
                    defer {
                        do { try FileManager.default.removeItem(at: url) }
                        catch { NSLog("[AudioDecode] Temporary audio cleanup failed: %@", String(describing: error)) }
                    }
                    let wav = try Self.decodeWav(url)
                    call.resolve(["wav": wav.base64EncodedString()])
                } catch {
                    call.reject("Native audio decoding failed: \(error.localizedDescription)", nil, error)
                }
            }
        }
    }

    private static func decodeWav(_ url: URL) throws -> Data {
        let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: true)
        let format = file.processingFormat
        let bytesPerFrame = UInt64(format.channelCount) * 4
        guard bytesPerFrame > 0, bytesPerFrame <= UInt16.max,
              format.sampleRate > 0, format.sampleRate <= Double(UInt32.max) / Double(bytesPerFrame),
              file.length > 0, UInt64(file.length) <= (UInt64(UInt32.max) - 36) / bytesPerFrame,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length)) else {
            throw NSError(domain: "AudioDecode", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Audio cannot be represented as a PCM WAV"
            ])
        }
        try file.read(into: buffer)
        let audio = buffer.audioBufferList.pointee.mBuffers
        guard buffer.frameLength == AVAudioFrameCount(file.length), let samples = audio.mData else {
            throw NSError(domain: "AudioDecode", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Audio decoded to an incomplete buffer"
            ])
        }
        let pcm = Data(bytes: samples, count: Int(audio.mDataByteSize))
        var wav = Data()
        func word<T: FixedWidthInteger>(_ value: T) {
            var little = value.littleEndian
            withUnsafeBytes(of: &little) { wav.append(contentsOf: $0) }
        }
        wav.append(contentsOf: "RIFF".utf8)
        word(UInt32(36 + pcm.count))
        wav.append(contentsOf: "WAVEfmt ".utf8)
        word(UInt32(16))
        word(UInt16(3)) // IEEE float: no extra quantization after AAC decoding.
        word(UInt16(format.channelCount))
        word(UInt32(format.sampleRate))
        word(UInt32(format.sampleRate) * UInt32(bytesPerFrame))
        word(UInt16(bytesPerFrame))
        word(UInt16(32))
        wav.append(contentsOf: "data".utf8)
        word(UInt32(pcm.count))
        wav.append(pcm)
        return wav
    }
}
