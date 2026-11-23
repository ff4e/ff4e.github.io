cmake_minimum_required(VERSION 3.28)
project(ff4e_native C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_EXTENSIONS ON) # statement expressions in the argument helpers

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
add_executable(ff4e-native host/main.c host/text.c host/audio.c host/audio_decode_apple.c)
target_include_directories(ff4e-native PRIVATE ${CMAKE_CURRENT_BINARY_DIR} ${libwebp_SOURCE_DIR}/src)
target_link_libraries(ff4e-native PRIVATE qjs SDL3::SDL3-static webpdecoder freetype)
if(APPLE)
  target_link_libraries(ff4e-native PRIVATE "-framework AudioToolbox" "-framework CoreFoundation")
endif()
