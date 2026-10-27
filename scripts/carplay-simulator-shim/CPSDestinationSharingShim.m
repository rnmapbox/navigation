#import <Foundation/Foundation.h>
#import <objc/runtime.h>

// CarPlaySupport's simulator build declares CPSTemplateInstance <CPSDestinationSharingDelegate>
// but compiles out both required methods, so CarPlayTemplateUIHost dies when a CPMapTemplate loads.
static BOOL vehicleSupportsDestinationSharing(id self, SEL _cmd) { return NO; }
static void handleSharedDestination(id self, SEL _cmd, id destination, void (^completion)(BOOL, NSError *)) {
  if (completion) completion(NO, nil);
}

__attribute__((constructor)) static void install(void) {
  if (![NSProcessInfo.processInfo.processName isEqualToString:@"CarPlayTemplateUIHost"]) return;
  Class cls = objc_getClass("CPSTemplateInstance");
  if (!cls) return;
  BOOL a = class_addMethod(cls, sel_registerName("vehicleSupportsDestinationSharing"), (IMP)vehicleSupportsDestinationSharing, "B16@0:8");
  BOOL b = class_addMethod(cls, sel_registerName("handleSharedDestination:completion:"), (IMP)handleSharedDestination, "v32@0:8@16@?24");
  NSLog(@"CPSShim installed vehicleSupportsDestinationSharing=%d handleSharedDestination=%d", a, b);
}
