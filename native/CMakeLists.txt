cmake_minimum_required(VERSION 3.28)

# The Apple TV app needs tvOS 27, which leaves out the two Apple TVs SDL GPU cannot drive.
# SDL 3.4's Metal driver requires an A9 GPU or newer on tvOS (MTLGPUFamilyApple3, with no
# way round it), and the Apple TV HD (A8) runs up to tvOS 26: it would install from the Store
# and stop at launch with the no-GPU alert. tvOS 27 runs on the Apple TV 4K 2nd generation
# (A12) and newer only — which also leaves out the 4K 1st generation (A10X), a GPU SDL could
# drive. tvOS has no device capability that separates the A8 from the A9+, so the OS is the
# floor. The one place this number lives: native/tvos/build.mjs reads it from here, and checks
# the installed tvOS SDK is new enough before building anything. Set before project(): it is
# the toolchain's deployment target, and Xcode turns it into the app's MinimumOSVersion.
set(FF4E_TVOS_DEPLOYMENT_TARGET 27.0)
if(CMAKE_SYSTEM_NAME STREQUAL "tvOS")
  if(NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET ${FF4E_TVOS_DEPLOYMENT_TARGET} CACHE STRING "" FORCE)
  elseif(CMAKE_OSX_DEPLOYMENT_TARGET VERSION_LESS FF4E_TVOS_DEPLOYMENT_TARGET)
    message(FATAL_ERROR "tvOS ${CMAKE_OSX_DEPLOYMENT_TARGET} is below the app's floor, tvOS "
      "${FF4E_TVOS_DEPLOYMENT_TARGET}: older Apple TVs would install it and fail at launch (see above).")
  endif()
endif()

project(ff4e_native C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_EXTENSIONS ON) # statement expressions in the argument helpers

# The Apple TV app is this same project, configured for tvOS with the Xcode generator
# (native/tvos/build.mjs): one list of sources and one set of pinned dependencies for every
# platform, and an Xcode project for what only Xcode does — signing, the asset catalog,
# `xcodebuild archive`. Set before any target exists: the dependencies' static libraries are
# not installed into an archive, only the app is.
if(CMAKE_SYSTEM_NAME STREQUAL "tvOS")
  # Build against an SDK that knows the deployment target, or say what to install.
  execute_process(COMMAND xcrun --sdk ${CMAKE_OSX_SYSROOT} --show-sdk-version
    OUTPUT_VARIABLE TVOS_SDK_VERSION OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
  if(NOT TVOS_SDK_VERSION OR TVOS_SDK_VERSION VERSION_LESS CMAKE_OSX_DEPLOYMENT_TARGET)
    message(FATAL_ERROR "The installed tvOS SDK (${CMAKE_OSX_SYSROOT}: '${TVOS_SDK_VERSION}') is older "
      "than the app's deployment target, tvOS ${CMAKE_OSX_DEPLOYMENT_TARGET}. Install an Xcode with the "
      "tvOS ${CMAKE_OSX_DEPLOYMENT_TARGET} SDK (and its tvOS Simulator runtime: xcodebuild -downloadPlatform tvOS).")
  endif()
  set(CMAKE_XCODE_ATTRIBUTE_SKIP_INSTALL YES)
  set(CMAKE_XCODE_ATTRIBUTE_TARGETED_DEVICE_FAMILY 3)
  set(CMAKE_XCODE_ATTRIBUTE_ENABLE_BITCODE NO)
endif()

include(FetchContent)
# QuickJS-ng, pinned. Built from source so the same engine builds for macOS, tvOS and
# Windows/Xbox (it is CI-tested with MSVC) instead of depending on a host package.
# v0.17.0, by the commit the tag points to and the archive's SHA-256: a tag can be moved.
FetchContent_Declare(quickjs
  URL https://github.com/quickjs-ng/quickjs/archive/6d46d07d04041b40f4f49eaa7fdebe44c314c699.tar.gz
  URL_HASH SHA256=a62cf1ff7d6d2f82b90a2d247a57e9eb56b81c03feb1f372a53923426e358cb0
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  EXCLUDE_FROM_ALL)
FetchContent_MakeAvailable(quickjs)

# SDL3 and libwebp are pinned too, from their official release tarballs, so the pixels
# compare.mjs checks cannot move with whatever a package manager installs that day. These
# are the versions the 72-room parity was measured on (SDL 3.4.20, libwebp 1.6.0). Both are
# built static: one binary, nothing to install beside it on tvOS or Xbox later.
set(SDL_SHARED OFF CACHE BOOL "" FORCE)
set(SDL_STATIC ON CACHE BOOL "" FORCE)
set(SDL_TEST_LIBRARY OFF CACHE BOOL "" FORCE)
set(SDL_TESTS OFF CACHE BOOL "" FORCE)
set(SDL_EXAMPLES OFF CACHE BOOL "" FORCE)
FetchContent_Declare(SDL3
  URL https://github.com/libsdl-org/SDL/releases/download/release-3.4.20/SDL3-3.4.20.tar.gz
  URL_HASH SHA256=f3bb06f55bed9557227a700af2ea62e49497ebdf58037732a731a5fb3ef8581f
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  EXCLUDE_FROM_ALL)

# Only the decoder is linked; the tools and the encoder-side libraries are not built.
foreach(opt ANIM_UTILS CWEBP DWEBP GIF2WEBP IMG2WEBP VWEBP WEBPINFO LIBWEBPMUX WEBPMUX EXTRAS)
  set(WEBP_BUILD_${opt} OFF CACHE BOOL "" FORCE)
endforeach()
FetchContent_Declare(libwebp
  URL https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz
  URL_HASH SHA256=e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  EXCLUDE_FROM_ALL)
FetchContent_MakeAvailable(SDL3 libwebp)

# FreeType rasterises the subtitle glyphs (native/host/text.c). Not stb_truetype: the
# subtitle faces are VARIABLE fonts drawn at weight 500, and stb_truetype renders only a
# font's default instance (Mulish's is 200, a hairline). FreeType applies the weight axis
# (gvar/HVAR), and its stroker draws the subtitle outline. Built without its optional
# dependencies: the four faces are plain TrueType, read from memory.
foreach(opt ZLIB BZIP2 PNG HARFBUZZ BROTLI)
  set(FT_DISABLE_${opt} ON CACHE BOOL "" FORCE)
endforeach()
FetchContent_Declare(freetype
  # The project's two release sites, tried in turn; the hash is the same file's.
  URL https://download.savannah.gnu.org/releases/freetype/freetype-2.15.0.tar.xz
      https://downloads.sourceforge.net/project/freetype/freetype2/2.15.0/freetype-2.15.0.tar.xz
  URL_HASH SHA256=93cd47eb719c325107f2d3cf087d06299e944c3b48a40b55537302304dea1dd5
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  EXCLUDE_FROM_ALL)
FetchContent_MakeAvailable(freetype)

# The Metal shaders are compiled at runtime by SDL from MSL source, embedded here.
set(SHADER_SRC ${CMAKE_CURRENT_SOURCE_DIR}/host/shaders.metal)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${SHADER_SRC})
file(READ ${SHADER_SRC} SHADER_HEX HEX)
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," SHADER_BYTES "${SHADER_HEX}")
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/shaders_msl.h "static const char SHADERS_MSL[] = {${SHADER_BYTES} 0x00};\n")

# Sound: the mixer (host/audio.c) and the platform's AAC decoder — Audio Toolbox on Apple
# platforms (host/audio_decode_apple.c); Media Foundation would take its place on Windows.
# Movies: the player (host/movie.c) over the platform's decoder (host/movie.h) — AVFoundation
# on Apple platforms (host/movie_apple.m, Objective-C with ARC); Media Foundation on Windows.
enable_language(OBJC)
# The store: tvOS keeps it in NSUserDefaults and iCloud (host/store.c over host/store_apple.m,
# Foundation, ARC); a Mac stands in with files under --tv-store DIR.
add_executable(ff4e-native host/main.c host/text.c host/audio.c host/audio_decode_apple.c
  host/movie.c host/movie_apple.m host/store.c host/store_apple.m)
set_source_files_properties(host/movie_apple.m host/store_apple.m PROPERTIES COMPILE_OPTIONS "-fobjc-arc")
target_include_directories(ff4e-native PRIVATE ${CMAKE_CURRENT_BINARY_DIR} ${libwebp_SOURCE_DIR}/src)
target_link_libraries(ff4e-native PRIVATE qjs SDL3::SDL3-static webpdecoder freetype)
if(APPLE)
  target_link_libraries(ff4e-native PRIVATE "-framework AudioToolbox" "-framework CoreFoundation"
    "-framework AVFoundation" "-framework CoreMedia" "-framework CoreVideo" "-framework Foundation")
endif()

# The Apple TV app (native/README.md, "Apple TV"): the host as an app bundle, with its
# Info.plist, entitlements (iCloud key-value storage) and asset catalog (native/tvos/), the remote's absolute d-pad shim, and the game
# — the bundle and the assets native/tvos/stage.mjs picked — copied in after the link, before
# Xcode signs the app.
if(CMAKE_SYSTEM_NAME STREQUAL "tvOS")
  set(FF4E_TVOS_STAGE "${CMAKE_CURRENT_SOURCE_DIR}/build/tvos/bundle" CACHE PATH "the staged game (native/tvos/stage.mjs)")
  set(FF4E_VERSION "1.0" CACHE STRING "CFBundleShortVersionString")
  set(FF4E_BUILD "1" CACHE STRING "CFBundleVersion: the tvOS platform's own build number")
  set(TVOS_ASSETS ${CMAKE_CURRENT_SOURCE_DIR}/tvos/Assets.xcassets)
  target_sources(ff4e-native PRIVATE host/platform_tvos.m ${TVOS_ASSETS})
  set_source_files_properties(host/platform_tvos.m PROPERTIES COMPILE_OPTIONS "-fobjc-arc")
  set_source_files_properties(${TVOS_ASSETS} PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
  target_link_libraries(ff4e-native PRIVATE "-framework GameController" "-framework UIKit")
  set_target_properties(ff4e-native PROPERTIES
    MACOSX_BUNDLE TRUE
    OUTPUT_NAME "FishFillets"
    MACOSX_BUNDLE_INFO_PLIST ${CMAKE_CURRENT_SOURCE_DIR}/tvos/Info.plist
    XCODE_ATTRIBUTE_PRODUCT_NAME "FishFillets"
    XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER "io.github.ff4e.fishfillets4ever"
    XCODE_ATTRIBUTE_MARKETING_VERSION "${FF4E_VERSION}"
    XCODE_ATTRIBUTE_CURRENT_PROJECT_VERSION "${FF4E_BUILD}"
    XCODE_ATTRIBUTE_ASSETCATALOG_COMPILER_APPICON_NAME "App Icon & Top Shelf Image"
    XCODE_ATTRIBUTE_CODE_SIGN_STYLE Automatic
    XCODE_ATTRIBUTE_CODE_SIGN_ENTITLEMENTS "${CMAKE_CURRENT_SOURCE_DIR}/tvos/FishFillets.entitlements"
    XCODE_ATTRIBUTE_SKIP_INSTALL NO
    XCODE_ATTRIBUTE_INSTALL_PATH "$(LOCAL_APPS_DIR)"
    XCODE_ATTRIBUTE_DEBUG_INFORMATION_FORMAT "dwarf-with-dsym")
  add_custom_command(TARGET ff4e-native POST_BUILD
    COMMAND /bin/sh ${CMAKE_CURRENT_SOURCE_DIR}/tvos/copy-bundle.sh ${FF4E_TVOS_STAGE}
    VERBATIM)
endif()
