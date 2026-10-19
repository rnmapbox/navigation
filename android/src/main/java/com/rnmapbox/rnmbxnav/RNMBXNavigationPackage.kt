package com.rnmapbox.rnmbxnav

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

class RNMBXNavigationPackage : BaseReactPackage() {
  init {
    // Must be registered before any <MapView mapViewImpl="rnmbxnav"> is created, which can be earlier
    // than the first JS call into the module.
    RNMBXNavigationMapFactory.register()
  }

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == RNMBXNavigationModule.NAME) RNMBXNavigationModule(reactContext) else null

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(RNMBXNavigationViewportManager(), RNMBXNavigationViewManager())

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      RNMBXNavigationModule.NAME to ReactModuleInfo(
        name = RNMBXNavigationModule.NAME,
        className = RNMBXNavigationModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      )
    )
  }
}
