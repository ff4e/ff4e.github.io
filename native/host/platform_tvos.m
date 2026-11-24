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
 * The device console: `tvos_log` writes to the unified log (subsystem
 * io.github.ff4e.fishfillets4ever, category input), which Console.app and Xcode's device
 * console show (native/README.md, "Reading the remote's input log").
 */
#import <GameController/GameController.h>
#import <UIKit/UIKit.h>
#include <os/log.h>
#include <stdbool.h>

void native_remote_menu(bool pressed); /* main.c */

void tvos_log(const char *line) {
  static os_log_t log;
  if (!log) log = os_log_create("io.github.ff4e.fishfillets4ever", "input");
  os_log(log, "%{public}s", line);
}

static void attach(GCController *c) {
  GCMicroGamepad *m = c.microGamepad;
  if (!m || c.extendedGamepad) return;
  m.reportsAbsoluteDpadValues = YES;
  m.buttonMenu.pressedChangedHandler = ^(GCControllerButtonInput *b, float value, BOOL pressed) {
    native_remote_menu(pressed);
  };
}

void tvos_remote_init(void) {
  static id observer;
  if (observer) return;
  for (GCController *c in GCController.controllers) attach(c);
  observer = [NSNotificationCenter.defaultCenter addObserverForName:GCControllerDidConnectNotification
                                                             object:nil
                                                              queue:NSOperationQueue.mainQueue
                                                         usingBlock:^(NSNotification *n) {
                                                           attach(n.object);
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
