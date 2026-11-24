/* NSUserDefaults and NSUbiquitousKeyValueStore for the tvOS store (store_apple.h). ARC. */
#import <Foundation/Foundation.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include "store_apple.h"

static char *copy_bytes(NSData *d, size_t *len) {
  char *out = malloc(d.length + 1);
  if (!out) return NULL;
  memcpy(out, d.bytes, d.length);
  out[d.length] = 0;
  if (len) *len = d.length;
  return out;
}

/* Kept as NSData of the UTF-8 JSON, so its size in the 500 KB is exactly its byte count. */
char *ff_prefs_load(const char *key, size_t *len) {
  @autoreleasepool {
    NSData *d = [[NSUserDefaults standardUserDefaults] dataForKey:@(key)];
    return d ? copy_bytes(d, len) : NULL;
  }
}

bool ff_prefs_save(const char *key, const char *data, size_t len) {
  @autoreleasepool {
    NSUserDefaults *d = [NSUserDefaults standardUserDefaults];
    [d setObject:[NSData dataWithBytes:data length:len] forKey:@(key)];
    /* Not needed for the value to be kept eventually; asks for it now, so a power cut just
       after a save loses less. Its result is only logged: the value is set either way, and
       the cache, written next and fsynced, covers a flush that did not happen. */
    if (![d synchronize]) NSLog(@"store: NSUserDefaults did not flush now; it will later");
    return true;
  }
}

static atomic_bool kvs_changed;
static id kvs_observer;

void ff_kvs_start(void) {
  @autoreleasepool {
    NSUbiquitousKeyValueStore *kvs = NSUbiquitousKeyValueStore.defaultStore;
    kvs_observer = [[NSNotificationCenter defaultCenter]
        addObserverForName:NSUbiquitousKeyValueStoreDidChangeExternallyNotification
                    object:kvs
                     queue:nil
                usingBlock:^(NSNotification *note) {
                  NSNumber *reason = note.userInfo[NSUbiquitousKeyValueStoreChangeReasonKey];
                  if (reason.integerValue == NSUbiquitousKeyValueStoreQuotaViolationChange)
                    NSLog(@"store: iCloud key-value quota exceeded; a write was not kept");
                  else
                    atomic_store(&kvs_changed, true); /* server change, first download, account change */
                }];
    [kvs synchronize];
  }
}

bool ff_kvs_changed(void) { return atomic_exchange(&kvs_changed, false); }

char *ff_kvs_load_json(void) {
  @autoreleasepool {
    NSMutableDictionary *out = [NSMutableDictionary dictionary];
    [NSUbiquitousKeyValueStore.defaultStore.dictionaryRepresentation
        enumerateKeysAndObjectsUsingBlock:^(NSString *k, id v, BOOL *stop) {
          if ([k hasPrefix:@"ff4e."] && [v isKindOfClass:[NSString class]]) out[k] = v;
        }];
    NSData *d = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
    return d ? copy_bytes(d, NULL) : NULL;
  }
}

bool ff_kvs_set(const char *key, const char *value) {
  @autoreleasepool {
    NSUbiquitousKeyValueStore *kvs = NSUbiquitousKeyValueStore.defaultStore;
    if (value) [kvs setString:@(value) forKey:@(key)];
    else [kvs removeObjectForKey:@(key)];
    return true;
  }
}
