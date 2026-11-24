/*
 * The tvOS store's host side (native/js/tvStore.ts): NSUserDefaults and iCloud's key-value
 * store on tvOS (store_apple.m), and on a Mac, with `--tv-store DIR`, files in DIR that
 * stand in for them — with tvOS's limits enforced, so the policy is tested against them:
 *
 *   prefsLoad(damaged) / prefsSave(json, damaged)  NSUserDefaults "ff4e.store" (or
 *       "ff4e.store.damaged"), as UTF-8 NSData; DIR/defaults.json. Over 500 000 bytes is
 *       refused (Apple: "500 KB of persistent storage ... using the NSUserDefaults class").
 *   kvsLoad() / kvsSave(key, value|null)  every `ff4e.` key of NSUbiquitousKeyValueStore;
 *       DIR/kvs.json. Refused past its limits: 1024 keys, 1 MB of values, 128-character keys.
 *   tvStore  true on tvOS or with --tv-store: shims.ts uses TvStore.
 *
 * The cache file is the host's ordinary store file (main.c's storeLoad/storeSave): on tvOS
 * SDL_GetPrefPath is in Caches, which the system may empty while the app is not running.
 * `store_remote_changed()` is polled once a frame; the frame loop turns it into `!kvs`.
 */
#include <SDL3/SDL.h>
#include <quickjs.h>
#include <stdlib.h>
#include <string.h>
#ifdef __APPLE__
#include "store_apple.h"
#endif

#define PREFS_LIMIT 500000
#define KVS_KEYS 1024
#define KVS_BYTES 1000000
#define KVS_KEY_LEN 128

static char tv_dir[2048]; /* --tv-store: the Mac stand-in's directory */

#ifdef SDL_PLATFORM_TVOS
#define TV_REAL 1
#else
#define TV_REAL 0
#endif

#if !TV_REAL
/* Only ever called with the stand-in on (shims.ts checks `tvStore`); "." if it were not. */
static void dir_file(char *out, size_t n, const char *name) {
  SDL_snprintf(out, n, "%s/%s", tv_dir[0] ? tv_dir : ".", name);
}

/* The stand-in's files: written beside, then renamed over, so never half-written. */
static bool save_file(const char *path, const char *data, size_t len) {
  char tmp[2100];
  SDL_snprintf(tmp, sizeof tmp, "%s.tmp", path);
  return SDL_SaveFile(tmp, data, len) && SDL_RenamePath(tmp, path);
}

static JSValue load_file(JSContext *ctx, const char *path, const char *absent) {
  size_t size = 0;
  char *data = SDL_LoadFile(path, &size);
  if (!data) return absent ? JS_NewString(ctx, absent) : JS_NULL;
  JSValue s = JS_NewStringLen(ctx, data, size);
  SDL_free(data);
  return s;
}
#endif

static JSValue n_prefsLoad(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  bool damaged = argc > 0 && JS_ToBool(ctx, argv[0]);
#if TV_REAL
  size_t len = 0;
  char *data = ff_prefs_load(damaged ? "ff4e.store.damaged" : "ff4e.store", &len);
  if (!data) return JS_NULL;
  JSValue s = JS_NewStringLen(ctx, data, len);
  free(data);
  return s;
#else
  char path[2100];
  dir_file(path, sizeof path, damaged ? "defaults.damaged.json" : "defaults.json");
  return load_file(ctx, path, NULL);
#endif
}

static JSValue n_prefsSave(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  bool damaged = argc > 1 && JS_ToBool(ctx, argv[1]);
  size_t len = 0;
  const char *json = JS_ToCStringLen(ctx, &len, argv[0]);
  if (!json) return JS_EXCEPTION;
  if (len > PREFS_LIMIT) {
    JS_FreeCString(ctx, json);
    return JS_ThrowRangeError(ctx, "NSUserDefaults: %zu bytes is over tvOS's %d", len, PREFS_LIMIT);
  }
#if TV_REAL
  bool ok = ff_prefs_save(damaged ? "ff4e.store.damaged" : "ff4e.store", json, len);
#else
  char path[2100];
  dir_file(path, sizeof path, damaged ? "defaults.damaged.json" : "defaults.json");
  bool ok = save_file(path, json, len);
#endif
  JS_FreeCString(ctx, json);
  return ok ? JS_UNDEFINED : JS_ThrowTypeError(ctx, "NSUserDefaults: not written: %s", SDL_GetError());
}

static JSValue kvs_json(JSContext *ctx) {
#if TV_REAL
  char *data = ff_kvs_load_json();
  JSValue s = JS_NewString(ctx, data ? data : "{}");
  free(data);
  return s;
#else
  char path[2100];
  dir_file(path, sizeof path, "kvs.json");
  return load_file(ctx, path, "{}");
#endif
}

static JSValue n_kvsLoad(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  return kvs_json(ctx);
}

static size_t utf8_len(JSContext *ctx, JSValueConst v) {
  size_t len = 0;
  const char *s = JS_ToCStringLen(ctx, &len, v);
  if (s) JS_FreeCString(ctx, s);
  return len;
}

/* Set or remove one key, refusing what iCloud would refuse (it fails such a write whole). */
static JSValue n_kvsSave(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  JSValue keylen = JS_GetPropertyStr(ctx, argv[0], "length");
  int32_t klen = 0;
  JS_ToInt32(ctx, &klen, keylen);
  JS_FreeValue(ctx, keylen);
  if (klen > KVS_KEY_LEN) return JS_ThrowRangeError(ctx, "iCloud: a key is at most %d characters", KVS_KEY_LEN);
  bool remove = argc < 2 || JS_IsNull(argv[1]) || JS_IsUndefined(argv[1]);

  JSValue text = kvs_json(ctx);
  size_t tlen = 0;
  const char *t = JS_ToCStringLen(ctx, &tlen, text);
  JS_FreeValue(ctx, text);
  if (!t) return JS_EXCEPTION;
  JSValue obj = JS_ParseJSON(ctx, t, tlen, "kvs.json");
  JS_FreeCString(ctx, t);
  if (JS_IsException(obj)) return obj;
  JSAtom key = JS_ValueToAtom(ctx, argv[0]);
  if (remove) JS_DeleteProperty(ctx, obj, key, 0);
  else JS_SetProperty(ctx, obj, key, JS_DupValue(ctx, argv[1]));
  JS_FreeAtom(ctx, key);

  JSPropertyEnum *props = NULL;
  uint32_t n = 0;
  size_t bytes = 0;
  if (JS_GetOwnPropertyNames(ctx, &props, &n, obj, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) == 0) {
    for (uint32_t i = 0; i < n; i++) {
      JSValue v = JS_GetProperty(ctx, obj, props[i].atom);
      bytes += utf8_len(ctx, v);
      JS_FreeValue(ctx, v);
    }
    JS_FreePropertyEnum(ctx, props, n);
  }
  if (n > KVS_KEYS || bytes > KVS_BYTES) {
    JS_FreeValue(ctx, obj);
    return JS_ThrowRangeError(ctx, "iCloud: %u keys, %zu bytes is over its limits (%d, %d)", n, bytes, KVS_KEYS, KVS_BYTES);
  }
#if TV_REAL
  JS_FreeValue(ctx, obj);
  const char *k = JS_ToCString(ctx, argv[0]);
  const char *v = remove ? NULL : JS_ToCString(ctx, argv[1]);
  bool ok = k && (remove || v) && ff_kvs_set(k, v);
  if (v) JS_FreeCString(ctx, v);
  if (k) JS_FreeCString(ctx, k);
#else
  JSValue out = JS_JSONStringify(ctx, obj, JS_UNDEFINED, JS_UNDEFINED);
  JS_FreeValue(ctx, obj);
  size_t olen = 0;
  const char *o = JS_ToCStringLen(ctx, &olen, out);
  JS_FreeValue(ctx, out);
  char path[2100];
  dir_file(path, sizeof path, "kvs.json");
  bool ok = o && save_file(path, o, olen);
  if (o) JS_FreeCString(ctx, o);
#endif
  return ok ? JS_UNDEFINED : JS_ThrowTypeError(ctx, "iCloud: not written: %s", SDL_GetError());
}

/* Another device's progress arrived (tvOS only): the frame loop sends `!kvs`. */
bool store_remote_changed(void) {
#if TV_REAL
  return ff_kvs_changed();
#else
  return false;
#endif
}

/* argv: the arguments after the bundle (main.c's js_argv). */
void install_store(JSContext *ctx, JSValue native, int argc, char **argv) {
  for (int i = 0; i + 1 < argc; i++)
    if (!strcmp(argv[i], "--tv-store")) SDL_strlcpy(tv_dir, argv[i + 1], sizeof tv_dir);
  bool on = TV_REAL || tv_dir[0];
  if (tv_dir[0] && !SDL_CreateDirectory(tv_dir)) SDL_Log("--tv-store %s: %s", tv_dir, SDL_GetError());
#if TV_REAL
  ff_kvs_start();
#endif
  JS_SetPropertyStr(ctx, native, "tvStore", JS_NewBool(ctx, on));
  JS_SetPropertyStr(ctx, native, "prefsLoad", JS_NewCFunction(ctx, n_prefsLoad, "prefsLoad", 1));
  JS_SetPropertyStr(ctx, native, "prefsSave", JS_NewCFunction(ctx, n_prefsSave, "prefsSave", 2));
  JS_SetPropertyStr(ctx, native, "kvsLoad", JS_NewCFunction(ctx, n_kvsLoad, "kvsLoad", 0));
  JS_SetPropertyStr(ctx, native, "kvsSave", JS_NewCFunction(ctx, n_kvsSave, "kvsSave", 2));
}
