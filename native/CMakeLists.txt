cmake_minimum_required(VERSION 3.28)
project(ff4e_native C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_EXTENSIONS ON) # statement expressions in the argument helpers

include(FetchContent)
# QuickJS-ng, pinned. Built from source so the same engine builds for macOS, tvOS and
# Windows/Xbox (it is CI-tested with MSVC) instead of depending on a host package.
FetchContent_Declare(quickjs
  GIT_REPOSITORY https://github.com/quickjs-ng/quickjs.git
  GIT_TAG v0.17.0
  GIT_SHALLOW TRUE
  EXCLUDE_FROM_ALL)
FetchContent_MakeAvailable(quickjs)

find_package(SDL3 REQUIRED CONFIG)
find_path(WEBP_INCLUDE_DIR webp/decode.h REQUIRED)
find_library(WEBP_LIBRARY webp REQUIRED)

# The Metal shaders are compiled at runtime by SDL from MSL source, embedded here.
set(SHADER_SRC ${CMAKE_CURRENT_SOURCE_DIR}/host/shaders.metal)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${SHADER_SRC})
file(READ ${SHADER_SRC} SHADER_HEX HEX)
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," SHADER_BYTES "${SHADER_HEX}")
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/shaders_msl.h "static const char SHADERS_MSL[] = {${SHADER_BYTES} 0x00};\n")

add_executable(ff4e-native host/main.c)
target_include_directories(ff4e-native PRIVATE ${CMAKE_CURRENT_BINARY_DIR} ${WEBP_INCLUDE_DIR})
target_link_libraries(ff4e-native PRIVATE qjs SDL3::SDL3 ${WEBP_LIBRARY})
