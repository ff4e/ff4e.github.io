/*
 * movie.h on Apple platforms: AVFoundation's AVAssetReader. VideoToolbox decodes the H.264
 * (in hardware where there is some) and converts it to BGRA by the colour description the
 * file carries; Audio Toolbox decodes the AAC. Builds for macOS and tvOS alike.
 *
 * The synchronous asset properties (`tracksWithMediaType:`, `duration`, `naturalSize`) are
 * deprecated in favour of async loaders since macOS 13 / tvOS 16, but are still supported, and
 * for a local file they return at once: the player opens a movie between two frames.
 */
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#include <SDL3/SDL.h>

#include "movie.h"

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

/* Retained Objective-C objects, held as CF references: a C struct is not ARC's to manage. */
struct MovieDecoder {
  CFTypeRef reader; /* AVAssetReader */
  CFTypeRef out;    /* AVAssetReaderTrackOutput */
};

struct MovieFrame {
  CMSampleBufferRef sample;
  CVPixelBufferRef px;
  bool locked;
};

static AVURLAsset *asset_at(const char *path) {
  NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
  return [AVURLAsset URLAssetWithURL:url options:@{AVURLAssetPreferPreciseDurationAndTimingKey : @YES}];
}

static void say(char *err, size_t errlen, NSString *what, NSError *e) {
  NSString *s = e ? [NSString stringWithFormat:@"%@: %@", what, e.localizedDescription] : what;
  SDL_strlcpy(err, s.UTF8String ?: "?", errlen);
}

MovieDecoder *movie_open(const char *path, double start, MovieInfo *info, char *err, size_t errlen) {
  @autoreleasepool {
    AVURLAsset *asset = asset_at(path);
    AVAssetTrack *video = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
    if (!video) {
      say(err, errlen, @"no video track (or not a movie)", nil);
      return NULL;
    }
    NSError *e = nil;
    AVAssetReader *reader = [AVAssetReader assetReaderWithAsset:asset error:&e];
    if (!reader) {
      say(err, errlen, @"cannot read the movie", e);
      return NULL;
    }
    if (start > 0) reader.timeRange = CMTimeRangeMake(CMTimeMakeWithSeconds(start, 600000), kCMTimePositiveInfinity);
    NSDictionary *settings = @{(id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA)};
    AVAssetReaderTrackOutput *out = [AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:video outputSettings:settings];
    out.alwaysCopiesSampleData = NO;
    if (![reader canAddOutput:out]) {
      say(err, errlen, @"cannot decode the video track to BGRA", nil);
      return NULL;
    }
    [reader addOutput:out];
    if (![reader startReading]) {
      say(err, errlen, @"cannot start reading", reader.error);
      return NULL;
    }
    CGSize size = video.naturalSize;
    info->width = (int)size.width;
    info->height = (int)size.height;
    info->duration = CMTimeGetSeconds(asset.duration);
    info->frame_rate = video.nominalFrameRate;
    MovieDecoder *m = SDL_calloc(1, sizeof *m);
    m->reader = CFBridgingRetain(reader);
    m->out = CFBridgingRetain(out);
    return m;
  }
}

MovieFrame *movie_next_frame(MovieDecoder *m, double *pts) {
  @autoreleasepool {
    for (;;) {
      CMSampleBufferRef s = [(__bridge AVAssetReaderTrackOutput *)m->out copyNextSampleBuffer];
      if (!s) return NULL;
      CVPixelBufferRef px = CMSampleBufferGetImageBuffer(s);
      if (!px) { /* a marker buffer with no image: not a frame */
        CFRelease(s);
        continue;
      }
      MovieFrame *f = SDL_calloc(1, sizeof *f);
      f->sample = s;
      f->px = px;
      *pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(s));
      return f;
    }
  }
}

const uint8_t *movie_frame_pixels(MovieFrame *f, size_t *stride) {
  if (!f->locked) {
    if (CVPixelBufferLockBaseAddress(f->px, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) return NULL;
    f->locked = true;
  }
  *stride = CVPixelBufferGetBytesPerRow(f->px);
  return CVPixelBufferGetBaseAddress(f->px);
}

void movie_frame_release(MovieFrame *f) {
  if (!f) return;
  if (f->locked) CVPixelBufferUnlockBaseAddress(f->px, kCVPixelBufferLock_ReadOnly);
  CFRelease(f->sample);
  SDL_free(f);
}

void movie_close(MovieDecoder *m) {
  if (!m) return;
  @autoreleasepool {
    AVAssetReader *reader = CFBridgingRelease(m->reader);
    CFRelease(m->out);
    [reader cancelReading];
  }
  SDL_free(m);
}

bool movie_decode_audio(const char *path, float **pcm, int64_t *frames, int *channels, int *rate, char *err, size_t errlen) {
  *pcm = NULL;
  *frames = 0;
  err[0] = 0;
  @autoreleasepool {
    AVURLAsset *asset = asset_at(path);
    AVAssetTrack *track = [asset tracksWithMediaType:AVMediaTypeAudio].firstObject;
    if (!track) return false;
    NSError *e = nil;
    AVAssetReader *reader = [AVAssetReader assetReaderWithAsset:asset error:&e];
    if (!reader) {
      say(err, errlen, @"cannot read the movie's audio", e);
      return false;
    }
    /* The track's own rate and channels (none named): only the sample format is asked for. */
    NSDictionary *settings = @{
      AVFormatIDKey : @(kAudioFormatLinearPCM),
      AVLinearPCMBitDepthKey : @32,
      AVLinearPCMIsFloatKey : @YES,
      AVLinearPCMIsNonInterleaved : @NO,
      AVLinearPCMIsBigEndianKey : @NO,
    };
    AVAssetReaderTrackOutput *out = [AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:track outputSettings:settings];
    [reader addOutput:out];
    if (![reader startReading]) {
      say(err, errlen, @"cannot start reading the audio", reader.error);
      return false;
    }
    size_t len = 0, cap = 0;
    float *buf = NULL;
    int ch = 0, sr = 0;
    for (;;) {
      CMSampleBufferRef s = [out copyNextSampleBuffer];
      if (!s) break;
      if (!ch) {
        const AudioStreamBasicDescription *d = CMAudioFormatDescriptionGetStreamBasicDescription(CMSampleBufferGetFormatDescription(s));
        if (d) {
          ch = (int)d->mChannelsPerFrame;
          sr = (int)d->mSampleRate;
        }
      }
      CMBlockBufferRef bb = CMSampleBufferGetDataBuffer(s);
      size_t n = bb ? CMBlockBufferGetDataLength(bb) / sizeof(float) : 0;
      if (len + n > cap) {
        cap = (len + n) * 2;
        float *grown = SDL_realloc(buf, cap * sizeof *buf);
        if (!grown) {
          CFRelease(s);
          SDL_free(buf);
          say(err, errlen, @"out of memory", nil);
          return false;
        }
        buf = grown;
      }
      if (n && CMBlockBufferCopyDataBytes(bb, 0, n * sizeof(float), buf + len) == kCMBlockBufferNoErr) len += n;
      CFRelease(s);
    }
    if (reader.status == AVAssetReaderStatusFailed || !ch || !sr) {
      SDL_free(buf);
      say(err, errlen, @"the audio did not decode", reader.error);
      return false;
    }
    *pcm = buf;
    *frames = (int64_t)(len / (size_t)ch);
    *channels = ch;
    *rate = sr;
    return *frames > 0;
  }
}
