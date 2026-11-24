/*
 * Where tvOS keeps the store (native/js/tvStore.ts), from Apple's Foundation: NSUserDefaults
 * for the copy that lasts, iCloud's key-value store (NSUbiquitousKeyValueStore) for the
 * progress every device shares. Called only on tvOS (store.c); built on every Apple platform
 * so a Mac build keeps it compiling.
 */
#ifndef FF4E_STORE_APPLE_H
#define FF4E_STORE_APPLE_H
#include <stdbool.h>
#include <stddef.h>

/* The bytes under `key` in NSUserDefaults (malloc'd, NUL-terminated), or NULL. */
char *ff_prefs_load(const char *key, size_t *len);
bool ff_prefs_save(const char *key, const char *data, size_t len);

/* Watch for other devices' changes and ask iCloud for the latest. Once, at startup. */
void ff_kvs_start(void);
/* Did another device's change (or the first download) arrive since the last call? */
bool ff_kvs_changed(void);
/* Every string under an `ff4e.` key, as a JSON object (malloc'd), or NULL. */
char *ff_kvs_load_json(void);
/* Set `key` to `value`, or remove it (`value` NULL). */
bool ff_kvs_set(const char *key, const char *value);

#endif
