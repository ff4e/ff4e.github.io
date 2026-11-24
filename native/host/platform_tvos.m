/*
 * tvOS only (built only for CMAKE_SYSTEM_NAME tvOS): what SDL leaves to the app.
 *
 * The Siri Remote's touch surface as ABSOLUTE positions. SDL presents the remote as a
 * gamepad whose left stick is the surface (SDL_mfijoystick.m), and GameController reports
 * it relative to where the thumb first touched unless `reportsAbsoluteDpadValues` is set —
 * which SDL never sets. The 1st-generation remote has no click ring: whether a click is an
 * edge or the centre is where the thumb rests when it clicks (main.c, `remote_button`), so
 * it needs the absolute position. Set on every controller with a micro gamepad profile (the
 * remotes), those connected now and those that connect later; main.c then measures swipes
 * from the touch-down itself (`remote_motion`). Written from Apple's documentation and SDL
 * 3.4's source; unverified until it runs on an Apple TV.
 */
#import <GameController/GameController.h>

static void absolute(GCController *c) {
  GCMicroGamepad *m = c.microGamepad;
  if (m) m.reportsAbsoluteDpadValues = YES;
}

void tvos_remote_absolute_dpad(void) {
  static id observer;
  if (observer) return;
  for (GCController *c in GCController.controllers) absolute(c);
  observer = [NSNotificationCenter.defaultCenter addObserverForName:GCControllerDidConnectNotification
                                                             object:nil
                                                              queue:NSOperationQueue.mainQueue
                                                         usingBlock:^(NSNotification *n) {
                                                           absolute(n.object);
                                                         }];
}
