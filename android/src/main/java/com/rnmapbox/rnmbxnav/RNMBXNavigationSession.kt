package com.rnmapbox.rnmbxnav

import android.app.Activity
import android.content.Context
import android.view.View
import com.mapbox.api.directions.v5.models.VoiceInstructions
import com.mapbox.common.MapboxOptions
import com.mapbox.common.location.Location
import com.mapbox.navigation.base.ExperimentalPreviewMapboxNavigationAPI
import com.mapbox.navigation.base.options.NavigationOptions
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.trip.model.RouteLegProgress
import com.mapbox.navigation.base.trip.model.RouteProgress
import com.mapbox.navigation.core.MapboxNavigation
import com.mapbox.navigation.core.MapboxNavigationProvider
import com.mapbox.navigation.core.arrival.ArrivalController
import com.mapbox.navigation.core.arrival.ArrivalObserver
import com.mapbox.navigation.core.directions.session.RoutesExtra
import com.mapbox.navigation.core.directions.session.RoutesObserver
import com.mapbox.navigation.core.replay.route.ReplayRouteMapper
import com.mapbox.navigation.core.routealternatives.AlternativeRouteMetadata
import com.mapbox.navigation.core.trip.session.LocationMatcherResult
import com.mapbox.navigation.core.trip.session.LocationObserver
import com.mapbox.navigation.core.trip.session.OffRouteObserver
import com.mapbox.navigation.core.trip.session.RouteProgressObserver
import com.mapbox.navigation.core.trip.session.VoiceInstructionsObserver
import com.mapbox.navigation.ui.base.util.MapboxNavigationConsumer
import com.mapbox.navigation.voice.api.MapboxSpeechApi
import com.mapbox.navigation.voice.api.MapboxVoiceInstructionsPlayer
import com.mapbox.navigation.voice.model.SpeechAnnouncement
import com.mapbox.navigation.voice.model.SpeechVolume
import java.lang.ref.WeakReference
import java.util.Locale

enum class RNMBXNavigationCameraState(val jsName: String) {
  FOLLOWING("following"),
  OVERVIEW("overview"),
  IDLE("idle"),
}

/**
 * Process-wide navigation state shared by the TurboModule and every adopted map. Listeners get the current
 * state replayed when they're added, so a map that attaches mid-guidance catches up. Main thread only.
 */
object RNMBXNavigationSession {
  interface Listener {
    fun onLocation(location: Location, keyPoints: List<Location>)
    fun onRoutes(routes: List<NavigationRoute>, preview: Boolean)
    fun onRouteProgress(progress: RouteProgress)
    fun onCameraState(state: RNMBXNavigationCameraState)
    fun onStopped()
  }

  private val listeners = mutableSetOf<Listener>()

  /** Called on every camera state change, from JS, guidance or a map gesture. */
  var cameraStateObserver: ((RNMBXNavigationCameraState) -> Unit)? = null

  var routeProgressObserver: ((RouteProgress) -> Unit)? = null
  var locationMatcherObserver: ((LocationMatcherResult) -> Unit)? = null
  var arrivalObserver: ((waypointIndex: Int, isFinalDestination: Boolean) -> Unit)? = null
  var offRouteObserver: ((Boolean) -> Unit)? = null
  var voiceInstructionObserver: ((VoiceInstructions) -> Unit)? = null
  var routeChangeObserver: ((List<NavigationRoute>, String) -> Unit)? = null

  var voiceMuted = false
    set(value) {
      field = value
      applyVoiceVolume()
    }

  var voiceVolume = 1f
    set(value) {
      field = value
      applyVoiceVolume()
    }

  var autoAdvanceLegs = true

  var simulationSpeed = 1.0
    @OptIn(ExperimentalPreviewMapboxNavigationAPI::class)
    set(value) {
      field = value
      if (simulating && MapboxNavigationProvider.isCreated()) {
        MapboxNavigationProvider.retrieve().mapboxReplayer.playbackSpeed(value)
      }
    }

  private val arrivalController = object : ArrivalController {
    override fun navigateNextRouteLeg(routeLegProgress: RouteLegProgress) = autoAdvanceLegs
  }

  var rerouteEnabled = true
    set(value) {
      field = value
      if (MapboxNavigationProvider.isCreated()) MapboxNavigationProvider.retrieve().setRerouteEnabled(value)
    }

  private var speechApi: MapboxSpeechApi? = null
  private var voicePlayer: MapboxVoiceInstructionsPlayer? = null
  private val onSpeechPlayed = MapboxNavigationConsumer<SpeechAnnouncement> { speechApi?.clean(it) }

  /** Kept until navigation stops, whether or not JS releases its `Route`. */
  private var guidanceRoute: RNMBXNavigationRoute? = null
  private var guidanceStart: Any? = null
  private var simulating = false

  var keepScreenOn = true
    set(value) {
      field = value
      updateKeepScreenOn()
    }

  /** Its window is kept on during guidance. */
  var activity: (() -> Activity?)? = null

  // The view's flag, not the window's, so apps setting `FLAG_KEEP_SCREEN_ON` themselves keep it.
  private var screenOnView: WeakReference<View>? = null
  private var viewKeptScreenOn = false

  /** Set by Android Auto's auto drive, which Play review uses: guidance then simulates. */
  var autoDrive = false

  private val navigationRouteProgressObserver = RouteProgressObserver { progress ->
    updateRouteProgress(progress)
    routeProgressObserver?.invoke(progress)
  }

  private val locationObserver = object : LocationObserver {
    override fun onNewRawLocation(rawLocation: Location) = Unit

    override fun onNewLocationMatcherResult(locationMatcherResult: LocationMatcherResult) {
      updateLocation(locationMatcherResult.enhancedLocation, locationMatcherResult.keyPoints)
      locationMatcherObserver?.invoke(locationMatcherResult)
    }
  }

  private val routesObserver = RoutesObserver { result ->
    val previousMainRouteId = routes.firstOrNull()?.id
    updateRoutes(result.navigationRoutes, preview = false)
    val reason = when (result.reason) {
      RoutesExtra.ROUTES_UPDATE_REASON_REROUTE -> "reroute"
      // Also reported when only the alternatives change.
      RoutesExtra.ROUTES_UPDATE_REASON_ALTERNATIVE ->
        if (result.navigationRoutes.firstOrNull()?.id != previousMainRouteId) "alternative" else null
      else -> null
    }
    if (reason != null && result.navigationRoutes.isNotEmpty()) {
      routeChangeObserver?.invoke(result.navigationRoutes, reason)
    }
  }

  private val navigationArrivalObserver = object : ArrivalObserver {
    override fun onWaypointArrival(routeProgress: RouteProgress) {
      arrivalObserver?.invoke((routeProgress.currentLegProgress?.legIndex ?: 0) + 1, false)
    }

    override fun onNextRouteLegStart(routeLegProgress: RouteLegProgress) {
      if (!simulating || !MapboxNavigationProvider.isCreated()) return
      val navigation = MapboxNavigationProvider.retrieve()
      navigation.getNavigationRoutes().firstOrNull()?.let { replayLeg(navigation, it, routeLegProgress.legIndex + 1) }
    }

    override fun onFinalDestinationArrival(routeProgress: RouteProgress) {
      if (arrivedAtFinalDestination) return
      arrivedAtFinalDestination = true
      arrivalObserver?.invoke(routeProgress.navigationRoute.directionsRoute.legs()?.size ?: 1, true)
    }
  }

  private var offRoute = false
  private var arrivedAtFinalDestination = false
  // The SDK also reports the current state when the observer is registered.
  private val navigationOffRouteObserver = OffRouteObserver { offRoute ->
    if (offRoute != this.offRoute) {
      this.offRoute = offRoute
      offRouteObserver?.invoke(offRoute)
    }
  }

  private val voiceInstructionsObserver = VoiceInstructionsObserver { instructions ->
    voiceInstructionObserver?.invoke(instructions)
    speechApi?.generate(instructions) { result ->
      result.fold(
        { error -> voicePlayer?.play(error.fallback, onSpeechPlayed) },
        { value -> voicePlayer?.play(value.announcement, onSpeechPlayed) }
      )
    }
  }

  private var location: Location? = null
  private var keyPoints: List<Location> = emptyList()
  private var routes: List<NavigationRoute> = emptyList()
  private var preview = false
  var cameraState = RNMBXNavigationCameraState.IDLE
    private set

  fun addListener(listener: Listener) {
    if (!listeners.add(listener)) return
    location?.let { listener.onLocation(it, keyPoints) }
    if (routes.isNotEmpty()) listener.onRoutes(routes, preview)
    listener.onCameraState(cameraState)
  }

  fun removeListener(listener: Listener) {
    listeners.remove(listener)
  }

  fun updateLocation(location: Location, keyPoints: List<Location>) {
    this.location = location
    this.keyPoints = keyPoints
    listeners.toList().forEach { it.onLocation(location, keyPoints) }
  }

  fun updateRoutes(routes: List<NavigationRoute>, preview: Boolean) {
    this.routes = routes
    this.preview = preview
    listeners.toList().forEach { it.onRoutes(routes, preview) }
  }

  fun updateRouteProgress(progress: RouteProgress) {
    listeners.toList().forEach { it.onRouteProgress(progress) }
  }

  fun updateCameraState(state: RNMBXNavigationCameraState) {
    if (state == cameraState) return
    cameraState = state
    listeners.toList().forEach { it.onCameraState(state) }
    cameraStateObserver?.invoke(state)
  }

  /** The SDK allows one `MapboxNavigation` per process; it outlives JS reloads. Null without an access token. */
  fun mapboxNavigation(context: Context): MapboxNavigation? {
    if (MapboxNavigationProvider.isCreated()) {
      return MapboxNavigationProvider.retrieve()
    }
    if (MapboxOptions.accessToken.isEmpty()) {
      return null
    }
    return MapboxNavigationProvider.create(NavigationOptions.Builder(context.applicationContext).build())
      .apply { setRerouteEnabled(rerouteEnabled) }
  }

  /** Throws [SecurityException] without location permission unless simulating. */
  @OptIn(ExperimentalPreviewMapboxNavigationAPI::class)
  fun startActiveGuidance(navigation: MapboxNavigation, route: RNMBXNavigationRoute, simulateRequested: Boolean) {
    val simulate = simulateRequested || autoDrive
    unregisterObservers(navigation)
    navigation.registerRouteProgressObserver(navigationRouteProgressObserver)
    navigation.registerLocationObserver(locationObserver)
    navigation.registerRoutesObserver(routesObserver)
    navigation.registerArrivalObserver(navigationArrivalObserver)
    navigation.registerOffRouteObserver(navigationOffRouteObserver)
    navigation.registerVoiceInstructionsObserver(voiceInstructionsObserver)
    navigation.setArrivalController(arrivalController)
    startVoice(navigation.navigationOptions.applicationContext, route)
    guidanceRoute = route
    updateKeepScreenOn()
    arrivedAtFinalDestination = false
    val start = Any()
    guidanceStart = start
    if (simulate) {
      // No foreground service: it needs runtime location permission, which simulation doesn't.
      navigation.startReplayTripSession(withForegroundService = false)
      navigation.mapboxReplayer.stop()
      navigation.mapboxReplayer.clearEvents()
    } else {
      navigation.startTripSession()
    }
    simulating = simulate
    updateCameraState(RNMBXNavigationCameraState.FOLLOWING)
    // Otherwise the navigator first matches the new route against the previous session's extrapolated location.
    navigation.resetTripSession {
      if (guidanceStart !== start) return@resetTripSession
      navigation.setNavigationRoutes(route.routes)
      if (simulate) {
        replayLeg(navigation, route.routes.first(), 0)
      }
    }
  }

  /** Simulates one leg at a time, so that the simulation waits at a waypoint while guidance does. */
  @OptIn(ExperimentalPreviewMapboxNavigationAPI::class)
  private fun replayLeg(navigation: MapboxNavigation, route: NavigationRoute, legIndex: Int) {
    val leg = route.directionsRoute.legs()?.getOrNull(legIndex) ?: return
    navigation.mapboxReplayer.run {
      stop()
      clearEvents()
      pushEvents(ReplayRouteMapper().mapRouteLegGeometry(leg))
      seekTo(0.0)
      playbackSpeed(simulationSpeed)
      play()
    }
  }

  fun advanceToNextLeg() {
    if (guidanceRoute == null || !MapboxNavigationProvider.isCreated()) return
    MapboxNavigationProvider.retrieve().navigateNextRouteLeg {}
  }

  /** Switches guidance to [route] if it's one of its alternatives. */
  @OptIn(ExperimentalPreviewMapboxNavigationAPI::class)
  fun selectAlternativeRoute(route: NavigationRoute) {
    if (guidanceRoute == null || preview || routes.firstOrNull() == route || route !in routes) return
    val navigation = MapboxNavigationProvider.retrieve()
    // The routes observer gets this switch as a new route set, not as an alternative.
    navigation.switchToAlternativeRoute(route) { result ->
      if (result.isValue && navigation.getNavigationRoutes().firstOrNull() == route) {
        routeChangeObserver?.invoke(navigation.getNavigationRoutes(), "alternative")
      }
    }
  }

  /** Lets the route line hide the part an alternative shares with the main route. */
  fun alternativesMetadata(routes: List<NavigationRoute>): List<AlternativeRouteMetadata> =
    if (guidanceRoute != null && !preview && MapboxNavigationProvider.isCreated()) {
      MapboxNavigationProvider.retrieve().getAlternativeMetadataFor(routes)
    } else {
      emptyList()
    }

  /** Also call it when [activity] may have changed. */
  fun updateKeepScreenOn() {
    val view = if (guidanceRoute != null && keepScreenOn) activity?.invoke()?.window?.decorView else null
    val current = screenOnView?.get()
    if (view === current) return
    current?.keepScreenOn = viewKeptScreenOn
    screenOnView = view?.let { WeakReference(it) }
    if (view != null) {
      viewKeptScreenOn = view.keepScreenOn
      view.keepScreenOn = true
    }
  }

  private fun startVoice(context: Context, route: RNMBXNavigationRoute) {
    stopVoice()
    val language = route.routes.first().directionsRoute.routeOptions()?.language() ?: Locale.getDefault().toLanguageTag()
    speechApi = MapboxSpeechApi(context, language)
    voicePlayer = MapboxVoiceInstructionsPlayer(context, language)
    applyVoiceVolume()
  }

  private fun applyVoiceVolume() {
    voicePlayer?.volume(SpeechVolume(if (voiceMuted) 0f else voiceVolume))
  }

  private fun stopVoice() {
    speechApi?.cancel()
    voicePlayer?.shutdown()
    speechApi = null
    voicePlayer = null
  }

  @OptIn(ExperimentalPreviewMapboxNavigationAPI::class)
  fun stopNavigation() {
    guidanceRoute = null
    updateKeepScreenOn()
    guidanceStart = null
    offRoute = false
    stopVoice()
    if (MapboxNavigationProvider.isCreated()) {
      val navigation = MapboxNavigationProvider.retrieve()
      unregisterObservers(navigation)
      if (simulating) {
        navigation.mapboxReplayer.stop()
        navigation.mapboxReplayer.clearEvents()
        simulating = false
      }
      navigation.setNavigationRoutes(emptyList())
      navigation.stopTripSession()
    }
    stop()
  }

  private fun unregisterObservers(navigation: MapboxNavigation) {
    navigation.unregisterRouteProgressObserver(navigationRouteProgressObserver)
    navigation.unregisterLocationObserver(locationObserver)
    navigation.unregisterRoutesObserver(routesObserver)
    navigation.unregisterArrivalObserver(navigationArrivalObserver)
    navigation.unregisterOffRouteObserver(navigationOffRouteObserver)
    navigation.unregisterVoiceInstructionsObserver(voiceInstructionsObserver)
  }

  private fun stop() {
    location = null
    keyPoints = emptyList()
    updateRoutes(emptyList(), preview = false)
    updateCameraState(RNMBXNavigationCameraState.IDLE)
    listeners.toList().forEach { it.onStopped() }
  }
}
