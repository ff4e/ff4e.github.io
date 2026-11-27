/*
 * tvOS only (built only for CMAKE_SYSTEM_NAME tvOS): what SDL leaves to the app.
 *
 * The Siri Remote's touch surface as ABSOLUTE positions. SDL presents the remote as a
 * gamepad whose left stick is the surface (SDL_mfijoystick.m), and GameController reports
 * it relative to where the thumb first touched unless `reportsAbsoluteDpadValues` is set —
 * which SDL never sets. The 1st-generation remote has no click ring: whether a click is an
 * edge or the centre is where the thumb rests when it clicks (main.c, `remote_button`), so
 * it needs the absolute position. A swipe is then the thumb's travel, which
 * native/js/remoteSwipe.ts measures from the position main.c hands over (`n_remoteTouch`).
 *
 * The remote's Menu/Back button, from GameController's own handler. SDL 3.4 reads it by
 * POLLING `isPressed` once per SDL_UpdateJoysticks (SDL_mfijoystick.m, IOS_MFIJoystickUpdate's
 * physicalInputProfile loop), but tvOS runs a gesture recognizer over that button and hands
 * the app its press and release together, after the fact — GameController's own header
 * says so (GCMicroGamepad.h, GCInputMicroGamepadButtonMenu: "You should avoid polling this
 * button every frame. tvOS will run a gesture recognizer on events before forwarding them
 * to your application that can reduce the window to poll button changes. Instead, register
 * a pressedChangedHandler"). Both land between two polls, so SDL sees nothing: on an Apple
 * TV Back opened the pause menu once in many presses (TestFlight tvOS build 2). SDL does
 * latch the deprecated `controllerPausedHandler` for this (`pause_button_pressed`), but only
 * its pre-tvOS-14 profiles read the latch. So the handler is registered here, on every
 * remote that connects, and every press it reports is counted and sent by main.c
 * (`native_remote_menu`), which then ignores SDL's polled copy of the button.
 *
 * Both are set on every remote (a controller with a micro gamepad profile and no extended
 * one: a pad's ☰ must never become Back), those connected now and those that connect later.
 *
 * A remote SDL does not map as a Siri Remote — the iPhone's Apple TV Remote in Control Center
 * ("Control Center Remote", GCProductCategories.h) — has no touch axes in SDL: its touch is
 * read here (`tvos_touchpad`, for main.c's `touchpad_thumb`). Every controller that connects
 * or goes is logged with what GameController says it is (`describe`): its names, profiles,
 * absolute values, rotation and elements, which decide how SDL maps it.
 *
 * The device console: `tvos_log` writes to the unified log (subsystem
 * io.github.ff4e.fishfillets4ever, category input), which Console.app and Xcode's device
 * console show (native/README.md, "Reading the remote's input log"); `tvos_log_audio` the
 * same, category audio.
 *
 * The audio session, which SDL 3.4 leaves half-handled on tvOS (native/README.md, "When the
 * sound does not come back"): it activates the session once and never again
 * (SDL_coreaudio.m's `session_active`), and after an interruption only retries
 * AudioQueueStart, on three notifications. So every notice the session gives — interrupted,
 * deactivated, resumption recommended, the route changed, media services lost or reset — is
 * logged and handed to the mixer (audio_notice), which reactivates the session
 * (`tvos_audio_activate`) and reopens its output when it has to (audio.c, audio_poll).
 */
#import <AVFAudio/AVFAudio.h>
#import <GameController/GameController.h>
#import <UIKit/UIKit.h>
#include <os/log.h>
#include <stdbool.h>
#include <string.h>

#include "audio.h"

void native_remote_menu(bool pressed); /* main.c */

void tvos_log(const char *line) {
  static os_log_t log;
  if (!log) log = os_log_create("io.github.ff4e.fishfillets4ever", "input");
  os_log(log, "%{public}s", line);
}

/* What GameController says a controller is: what decides how SDL maps it (main.c, the remote's kinds). */
static void describe(NSString *what, GCController *c) {
  GCMicroGamepad *m = c.microGamepad;
  GCPhysicalInputProfile *p = c.physicalInputProfile;
  NSArray<NSString *> *(^names)(NSDictionary *) = ^(NSDictionary *d) {
    return [d.allKeys sortedArrayUsingSelector:@selector(caseInsensitiveCompare:)];
  };
  NSString *line = [NSString stringWithFormat:@"controller %@: vendorName '%@', productCategory '%@', micro %d, extended %d, directional %d, "
                                              @"reportsAbsoluteDpadValues %d, allowsRotation %d, dpad analog %d; buttons %@; dpads %@",
                                              what, c.vendorName, c.productCategory, m != nil, c.extendedGamepad != nil,
                                              [m isKindOfClass:GCDirectionalGamepad.class], m.reportsAbsoluteDpadValues,
                                              m.allowsRotation, m.dpad.analog,
                                              [names(p.buttons) componentsJoinedByString:@", "],
                                              [names(p.dpads) componentsJoinedByString:@", "]];
  tvos_log(line.UTF8String);
}

static void attach(GCController *c) {
  GCMicroGamepad *m = c.microGamepad;
  if (!m || c.extendedGamepad) {
    describe(@"connected (a pad)", c);
    return;
  }
  m.reportsAbsoluteDpadValues = YES;
  m.buttonMenu.pressedChangedHandler = ^(GCControllerButtonInput *b, float value, BOOL pressed) {
    native_remote_menu(pressed);
  };
  describe(@"connected (a remote)", c);
}

/*
 * A touchpad remote's d-pad (main.c, `touchpad_thumb`): a remote SDL does not map as a Siri
 * Remote — a micro gamepad, no extended one, whose productCategory does not begin "Siri
 * Remote" (SDL_mfijoystick.m, `CheckControllerSiriRemote`) — has no touch axes in SDL, so its
 * touch is read here: v = x, y (GameController's: y up), up, down, left, right. The first such
 * remote a thumb is on, else the first; false when there is none.
 */
bool tvos_touchpad(float v[6]) {
  bool any = false;
  for (GCController *c in GCController.controllers) {
    GCMicroGamepad *m = c.microGamepad;
    if (!m || c.extendedGamepad || [c.productCategory hasPrefix:@"Siri Remote"]) continue;
    GCControllerDirectionPad *d = m.dpad;
    const float x = d.xAxis.value, y = d.yAxis.value;
    if (!any || x != 0 || y != 0) {
      v[0] = x, v[1] = y, v[2] = d.up.value, v[3] = d.down.value, v[4] = d.left.value, v[5] = d.right.value;
    }
    any = true;
    if (x != 0 || y != 0) break;
  }
  if (!any) memset(v, 0, 6 * sizeof *v);
  return any;
}

void tvos_remote_init(void) {
  static id observer, gone;
  if (observer) return;
  for (GCController *c in GCController.controllers) attach(c);
  observer = [NSNotificationCenter.defaultCenter addObserverForName:GCControllerDidConnectNotification
                                                             object:nil
                                                              queue:NSOperationQueue.mainQueue
                                                         usingBlock:^(NSNotification *n) {
                                                           attach(n.object);
                                                         }];
  gone = [NSNotificationCenter.defaultCenter addObserverForName:GCControllerDidDisconnectNotification
                                                         object:nil
                                                          queue:NSOperationQueue.mainQueue
                                                     usingBlock:^(NSNotification *n) {
                                                       describe(@"disconnected", n.object);
                                                     }];
}

/*
 * The window's GCEventViewController (SDL's root view controller on tvOS): whether controller
 * input goes to UIKit (1) or to GameController alone (0); -1 when there is none. `set` >= 0
 * sets it first — SDL sets it from SDL_HINT_APPLE_TV_CONTROLLER_UI_EVENTS's callback
 * (SDL_uikitviewcontroller.m, SDL_AppleTVControllerUIHintChanged), and main.c only does so
 * itself when the read-back disagrees with the hint.
 */
int tvos_ui_events(void *uiwindow, int set) {
  UIWindow *w = (__bridge UIWindow *)uiwindow;
  UIViewController *vc = w.rootViewController;
  if (![vc isKindOfClass:GCEventViewController.class]) return -1;
  GCEventViewController *g = (GCEventViewController *)vc;
  if (set >= 0) g.controllerUserInteractionEnabled = set ? YES : NO;
  return g.controllerUserInteractionEnabled ? 1 : 0;
}

/* ── The audio session ────────────────────────────────────────────────────────────── */

void tvos_log_audio(const char *line) {
  static os_log_t log;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ log = os_log_create("io.github.ff4e.fishfillets4ever", "audio"); });
  os_log(log, "%{public}s", line);
}

static NSString *route_text(AVAudioSessionRouteDescription *route) {
  NSMutableArray<NSString *> *outs = [NSMutableArray array];
  for (AVAudioSessionPortDescription *p in route.outputs) [outs addObject:[NSString stringWithFormat:@"%@ '%@'", p.portType, p.portName]];
  return outs.count ? [outs componentsJoinedByString:@" + "] : @"no output";
}

void tvos_audio_describe(char *out, size_t outlen) {
  AVAudioSession *s = AVAudioSession.sharedInstance;
  snprintf(out, outlen, "category %s, route %s, %.0f Hz, other audio playing %d", s.category.UTF8String,
           route_text(s.currentRoute).UTF8String, s.sampleRate, s.isOtherAudioPlaying);
}

bool tvos_audio_activate(char *err, size_t errlen) {
  NSError *e = nil;
  if ([AVAudioSession.sharedInstance setActive:YES error:&e]) return true;
  snprintf(err, errlen, "%s (%ld)", e.localizedDescription.UTF8String, (long)e.code);
  return false;
}

static void notice(AudioNotice what, NSString *detail) {
  audio_notice(what, detail.UTF8String);
}

void tvos_audio_init(void) {
  static bool done;
  if (done) return;
  done = true;
  NSNotificationCenter *c = NSNotificationCenter.defaultCenter;
  AVAudioSession *session = AVAudioSession.sharedInstance;
  /* queue nil: run on the posting thread, which may be any; audio_notice only logs and sets flags. */
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  /* Deprecated in tvOS 27 for the two below, but what SDL itself still listens to, so its
     every delivery is logged beside them. */
  [c addObserverForName:AVAudioSessionInterruptionNotification object:session queue:nil usingBlock:^(NSNotification *n) {
    NSUInteger type = [n.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
    NSUInteger opts = [n.userInfo[AVAudioSessionInterruptionOptionKey] unsignedIntegerValue];
    if (type == AVAudioSessionInterruptionTypeBegan) notice(AUDIO_LOST, @"interruption began");
    else notice(AUDIO_BACK, [NSString stringWithFormat:@"interruption ended, should resume %d", (opts & AVAudioSessionInterruptionOptionShouldResume) != 0]);
  }];
#pragma clang diagnostic pop
  [c addObserverForName:AVAudioSessionDidBecomeInactiveNotification object:session queue:nil usingBlock:^(NSNotification *n) {
    AVAudioSessionDeactivationContext *ctx = n.userInfo[AVAudioSessionDeactivationContextKey];
    BOOL system = ctx.source == AVAudioSessionDeactivationSourceSystem;
    NSString *why = ctx.interruptionContext ? [NSString stringWithFormat:@", interrupted (reason %lu)", (unsigned long)ctx.interruptionContext.reason] : @"";
    notice(system ? AUDIO_LOST : AUDIO_INFO, [NSString stringWithFormat:@"the session became inactive (by the %@%@)", system ? @"system" : @"app", why]);
  }];
  [c addObserverForName:AVAudioSessionDidBecomeActiveNotification object:session queue:nil usingBlock:^(NSNotification *n) {
    notice(AUDIO_INFO, @"the session became active");
  }];
  [c addObserverForName:AVAudioSessionResumptionRecommendationNotification object:session queue:nil usingBlock:^(NSNotification *n) {
    AVAudioSessionResumptionContext *ctx = n.userInfo[AVAudioSessionResumptionContextKey];
    /* Resumed either way: the game is on the screen, and its sound is the game. */
    notice(AUDIO_BACK, [NSString stringWithFormat:@"resumption %@", ctx.recommendation == AVAudioSessionResumptionRecommendationShouldResume ? @"recommended" : @"not recommended"]);
  }];
  [c addObserverForName:AVAudioSessionRouteChangeNotification object:session queue:nil usingBlock:^(NSNotification *n) {
    NSUInteger reason = [n.userInfo[AVAudioSessionRouteChangeReasonKey] unsignedIntegerValue];
    AVAudioSessionRouteDescription *before = n.userInfo[AVAudioSessionRouteChangePreviousRouteKey];
    notice(AUDIO_ROUTE, [NSString stringWithFormat:@"reason %lu, %@ -> %@", (unsigned long)reason, route_text(before),
                                                   route_text(AVAudioSession.sharedInstance.currentRoute)]);
  }];
  [c addObserverForName:AVAudioSessionMediaServicesWereLostNotification object:session queue:nil usingBlock:^(NSNotification *n) {
    notice(AUDIO_LOST, @"media services were lost");
  }];
  [c addObserverForName:AVAudioSessionMediaServicesWereResetNotification object:session queue:nil usingBlock:^(NSNotification *n) {
    notice(AUDIO_RESET, @"media services were reset");
  }];
  char d[256];
  tvos_audio_describe(d, sizeof d);
  audio_notice(AUDIO_INFO, d);
}
