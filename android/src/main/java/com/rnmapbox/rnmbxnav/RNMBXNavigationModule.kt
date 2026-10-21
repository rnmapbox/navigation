package com.rnmapbox.rnmbxnav

import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.turbomodule.core.interfaces.BindingsInstallerHolder
import com.facebook.react.turbomodule.core.interfaces.TurboModuleWithJSIBindings
import com.mapbox.api.directions.v5.models.RouteOptions
import com.mapbox.common.MapboxOptions
import com.mapbox.geojson.Point
import com.mapbox.navigation.base.extensions.applyDefaultNavigationOptions
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.route.NavigationRouterCallback
import com.mapbox.navigation.base.route.RouterFailure
import com.mapbox.navigation.base.trip.model.RouteProgress

class RNMBXNavigationModule(reactContext: ReactApplicationContext) :
  NativeRNMBXNavigationModuleSpec(reactContext), TurboModuleWithJSIBindings {

  init {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.cameraStateObserver = { state ->
        emitOnCameraStateChange(Arguments.createMap().apply { putString("state", state.jsName) })
      }
      RNMBXNavigationSession.routeProgressObserver = { progress -> emitOnRouteProgress(routeProgressEvent(progress)) }
    }
  }

  override fun setAccessToken(accessToken: String) {
    MapboxOptions.accessToken = accessToken
  }

  override fun getSdkVersion(): String = com.mapbox.navigation.core.BuildConfig.MAPBOX_NAVIGATION_VERSION_NAME

  @DoNotStrip
  external override fun getBindingsInstaller(): BindingsInstallerHolder

  /** Called by the C++ route bindings; see `RouteRequest` in cpp/RNMBXNavigationRoutes.h. */
  @DoNotStrip
  fun requestRoutesFromJS(
    coordinates: DoubleArray,
    names: Array<String?>,
    profile: String,
    alternatives: Boolean,
    exclude: Array<String>,
    language: String?,
    units: String?,
    callback: Long
  ) {
    val points = (0 until coordinates.size / 2).map { Point.fromLngLat(coordinates[2 * it], coordinates[2 * it + 1]) }
    if (points.size < 2) {
      RNMBXNavigationNative.reject(callback, "invalid_waypoints", "requestRoutes needs at least an origin and a destination")
      return
    }
    val options = RouteOptions.builder()
      .applyDefaultNavigationOptions(profile)
      .coordinatesList(points)
      .alternatives(alternatives)
      .apply {
        if (names.any { it != null }) waypointNamesList(names.map { it ?: "" })
        if (exclude.isNotEmpty()) excludeList(exclude.toList())
        language?.let { language(it) }
        units?.let { voiceUnits(it) }
      }
      .build()

    UiThreadUtil.runOnUiThread {
      val navigation = RNMBXNavigationSession.mapboxNavigation(reactApplicationContext)
      if (navigation == null) {
        RNMBXNavigationNative.reject(callback, "no_access_token", "Call Navigation.setAccessToken before using navigation")
        return@runOnUiThread
      }
      navigation.requestRoutes(
        options,
        object : NavigationRouterCallback {
          override fun onRoutesReady(routes: List<NavigationRoute>, routerOrigin: String) {
            RNMBXNavigationNative.resolveRoutes(
              callback,
              routes.indices.map { index ->
                RNMBXNavigationRoute(listOf(routes[index]) + routes.filterIndexed { other, _ -> other != index })
              }.toTypedArray()
            )
          }

          override fun onFailure(reasons: List<RouterFailure>, routeOptions: RouteOptions) {
            RNMBXNavigationNative.reject(callback, "route_request_failed", reasons.joinToString { it.message })
          }

          override fun onCanceled(routeOptions: RouteOptions, routerOrigin: String) {
            RNMBXNavigationNative.reject(callback, "route_request_canceled", "Route request was canceled")
          }
        }
      )
    }
  }

  @DoNotStrip
  fun startActiveGuidanceFromJS(route: RNMBXNavigationRoute, simulate: Boolean, callback: Long) {
    UiThreadUtil.runOnUiThread {
      val navigation = RNMBXNavigationSession.mapboxNavigation(reactApplicationContext)
      if (navigation == null) {
        RNMBXNavigationNative.reject(callback, "no_access_token", "Call Navigation.setAccessToken before using navigation")
        return@runOnUiThread
      }
      try {
        RNMBXNavigationSession.startActiveGuidance(navigation, route, simulate)
        RNMBXNavigationNative.resolve(callback)
      } catch (e: SecurityException) {
        RNMBXNavigationNative.reject(callback, "start_failed", e.message ?: e.toString())
      }
    }
  }

  /** Shows [route] on navigation maps until guidance starts or stops; `null` removes it. */
  @DoNotStrip
  fun previewRouteFromJS(route: RNMBXNavigationRoute?) {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.updateRoutes(route?.routes.orEmpty(), preview = true)
    }
  }

  override fun stopNavigation() {
    UiThreadUtil.runOnUiThread { RNMBXNavigationSession.stopNavigation() }
  }

  override fun setCameraState(state: String) {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.updateCameraState(
        RNMBXNavigationCameraState.entries.find { it.jsName == state } ?: RNMBXNavigationCameraState.IDLE
      )
    }
  }

  override fun getCameraState(): String = RNMBXNavigationSession.cameraState.jsName

  override fun invalidate() {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.cameraStateObserver = null
      RNMBXNavigationSession.routeProgressObserver = null
      RNMBXNavigationSession.stopNavigation()
    }
    super.invalidate()
  }

  companion object {
    const val NAME = NativeRNMBXNavigationModuleSpec.NAME

    init {
      System.loadLibrary("rnmbxnav")
    }
  }
}

fun routeProgressEvent(progress: RouteProgress): WritableMap {
  val stepProgress = progress.currentLegProgress?.currentStepProgress
  val banner = progress.bannerInstructions?.primary()
  val upcomingManeuver = progress.currentLegProgress?.upcomingStep?.maneuver()
  return Arguments.createMap().apply {
    putDouble("distanceRemaining", progress.distanceRemaining.toDouble())
    putDouble("distanceTraveled", progress.distanceTraveled.toDouble())
    putDouble("durationRemaining", progress.durationRemaining)
    putDouble("fractionTraveled", progress.fractionTraveled.toDouble())
    putDouble("stepDistanceRemaining", stepProgress?.distanceRemaining?.toDouble() ?: 0.0)
    putString("maneuverInstruction", banner?.text() ?: upcomingManeuver?.instruction() ?: "")
    putString("maneuverType", banner?.type() ?: upcomingManeuver?.type() ?: "")
    putString("maneuverModifier", banner?.modifier() ?: upcomingManeuver?.modifier() ?: "")
  }
}
