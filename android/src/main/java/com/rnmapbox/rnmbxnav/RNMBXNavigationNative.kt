package com.rnmapbox.rnmbxnav

import com.facebook.proguard.annotations.DoNotStrip

/** Completes calls from the C++ route bindings (android/src/main/cpp); each `callback` must be completed exactly once. */
@DoNotStrip
internal object RNMBXNavigationNative {
  @JvmStatic external fun resolveRoutes(callback: Long, routes: Array<RNMBXNavigationRoute>)

  @JvmStatic external fun resolve(callback: Long)

  @JvmStatic external fun reject(callback: Long, code: String, message: String)

  @JvmStatic external fun findRoute(id: Double): RNMBXNavigationRoute?
}
