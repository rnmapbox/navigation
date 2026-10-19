package com.rnmapbox.rnmbxnav

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.RNMBXNavigationViewManagerDelegate
import com.facebook.react.viewmanagers.RNMBXNavigationViewManagerInterface

@ReactModule(name = RNMBXNavigationViewManager.REACT_CLASS)
class RNMBXNavigationViewManager :
  SimpleViewManager<RNMBXNavigationView>(),
  RNMBXNavigationViewManagerInterface<RNMBXNavigationView> {

  private val delegate = RNMBXNavigationViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<RNMBXNavigationView> = delegate

  override fun getName() = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext) = RNMBXNavigationView(context)

  override fun setRouteId(view: RNMBXNavigationView, value: Double) {
    if (value == 0.0) return
    val route = RNMBXNavigationNative.findRoute(value)
    if (route == null) {
      view.dispatchError("route_released", "Route was released")
    } else {
      view.route = route
    }
  }

  override fun setSimulate(view: RNMBXNavigationView, value: Boolean) {
    view.simulate = value
  }

  override fun setMute(view: RNMBXNavigationView, value: Boolean) {
    view.mute = value
  }

  override fun onAfterUpdateTransaction(view: RNMBXNavigationView) {
    super.onAfterUpdateTransaction(view)
    view.startGuidanceIfNeeded()
  }

  override fun onDropViewInstance(view: RNMBXNavigationView) {
    view.stop()
    super.onDropViewInstance(view)
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
    listOf("topRouteProgress", "topArrive", "topCancel", "topError").associateWith {
      mapOf("registrationName" to "on" + it.removePrefix("top"))
    }

  companion object {
    const val REACT_CLASS = "RNMBXNavigationView"
  }
}
