cmake_minimum_required(VERSION 3.13)
project(rnmbxnav)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

add_library(rnmbxnav SHARED
  ../cpp/RNMBXNavigationRoutes.cpp
  src/main/cpp/RNMBXNavigationRoutesJni.cpp
)

target_include_directories(rnmbxnav PRIVATE ../cpp)

target_link_libraries(rnmbxnav
  ReactAndroid::jsi
  ReactAndroid::reactnative
  fbjni::fbjni
  android
  log
)
