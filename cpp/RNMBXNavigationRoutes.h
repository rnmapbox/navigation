#pragma once

#include <ReactCommon/CallInvoker.h>
#include <jsi/jsi.h>

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace rnmbxnav {

namespace jsi = facebook::jsi;

struct RouteLeg {
  double distance = 0;
  double expectedTravelTime = 0;
  int stepCount = 0;
  std::string summary;
};

/// Immutable snapshot of a route, copied from the SDK when the route is created so getters never leave the JS thread.
struct RouteData {
  double distance = 0;
  double expectedTravelTime = 0;
  /// Longitude, latitude pairs.
  std::vector<double> coordinates;
  std::vector<RouteLeg> legs;
};

/// Owns the platform SDK route. Its destructor may run on any thread.
class NativeRoute {
 public:
  virtual ~NativeRoute() = default;
};

struct RouteResult {
  RouteData data;
  std::shared_ptr<NativeRoute> native;
};

struct Waypoint {
  double longitude = 0;
  double latitude = 0;
  std::optional<std::string> name;
};

struct RouteRequest {
  std::vector<Waypoint> waypoints;
  /// Mapbox Directions profile without the `mapbox/` prefix, e.g. "driving-traffic".
  std::string profile = "driving-traffic";
  bool alternatives = false;
  std::vector<std::string> exclude;
  std::optional<std::string> language;
  /// "metric" or "imperial".
  std::optional<std::string> units;
};

using RejectCallback = std::function<void(const std::string &code, const std::string &message)>;

/// Platform side of the bindings. The callbacks may be called on any thread, and exactly one of them once.
class NavigationPlatform {
 public:
  virtual ~NavigationPlatform() = default;

  /// Resolves with the main route first, then the alternatives.
  virtual void requestRoutes(
      const RouteRequest &request,
      std::function<void(std::vector<RouteResult> routes)> resolve,
      RejectCallback reject) = 0;

  virtual void startActiveGuidance(
      const std::shared_ptr<NativeRoute> &route,
      bool simulate,
      std::function<void()> resolve,
      RejectCallback reject) = 0;

  /// `nullptr` clears the preview.
  virtual void previewRoute(const std::shared_ptr<NativeRoute> &route) = 0;
};

struct RouteStats {
  /// Routes JS still holds a native route for.
  std::atomic<int64_t> live{0};
  std::atomic<int64_t> released{0};
  /// Routes the GC finalized before `release()` was called.
  std::atomic<int64_t> collected{0};
};

RouteStats &routeStats();

class RouteHostObject : public jsi::HostObject, public std::enable_shared_from_this<RouteHostObject> {
 public:
  RouteHostObject(RouteData data, std::shared_ptr<NativeRoute> native);
  ~RouteHostObject() override;

  jsi::Value get(jsi::Runtime &runtime, const jsi::PropNameID &name) override;
  void set(jsi::Runtime &runtime, const jsi::PropNameID &name, const jsi::Value &value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime &runtime) override;

  /// The native route, or `nullptr` once released.
  std::shared_ptr<NativeRoute> native() const;
  void release();

  double id() const
  {
    return id_;
  }

 private:
  const RouteData data_;
  mutable std::mutex mutex_;
  std::shared_ptr<NativeRoute> native_;
  double id_ = 0;
};

/// Thread-safe; `nullptr` once the route is released.
std::shared_ptr<NativeRoute> findRoute(double id);

/// Installs `global.__RNMBXNavigationRoutes`, wrapped by `src/Route.ts`.
void install(
    jsi::Runtime &runtime,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker,
    std::shared_ptr<NavigationPlatform> platform);

} // namespace rnmbxnav
