#pragma once

#include "RNMBXNavigationRoutes.h"

@class RNMBXNavigation;
@class RNMBXNavigationRoute;

namespace rnmbxnav {

std::shared_ptr<NavigationPlatform> makeNavigationPlatform(RNMBXNavigation *navigation);

RNMBXNavigationRoute *findPlatformRoute(double id);

} // namespace rnmbxnav
