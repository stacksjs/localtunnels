//
//  Starting TunnelControl, in the only place there is to start it from.
//
//  The app's entry point is `@main struct BuddyVPNApp` with Craft's own
//  `UIApplicationDelegate` adapted into it, and both are generated and
//  rewritten on every build. There is no `application(_:didFinishLaunching…)`
//  of ours to add a line to, and no SwiftUI view we own that is guaranteed to
//  appear — the app can launch into the background with nothing drawn.
//
//  Objective-C `+load` runs when the image is loaded, before `main`, and it
//  is the one hook that needs nobody's permission. Swift removed `load()`
//  overriding precisely because it runs so early, which is why this is three
//  lines of Objective-C rather than Swift.
//
//  It waits for `UIApplicationDidFinishLaunchingNotification` rather than
//  acting at load time: `UIApplication.shared` does not exist yet at `+load`,
//  and `NETunnelProviderManager` wants a running application.
//
//  `NSClassFromString` and `performSelector` rather than an import of
//  `BuddyVPN-Swift.h`: that header is generated from the target's own name,
//  so importing it would tie this file to an app called BuddyVPN. Reaching
//  the class through the runtime costs one string and keeps the file
//  portable. `TunnelControl` is spelled `@objc(TunnelControl)` on the Swift
//  side so the name carries no module prefix.
//
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@interface CraftTunnelBootstrap : NSObject
@end

@implementation CraftTunnelBootstrap

+ (void)load {
    [[NSNotificationCenter defaultCenter]
        addObserverForName:UIApplicationDidFinishLaunchingNotification
                    object:nil
                     queue:[NSOperationQueue mainQueue]
                usingBlock:^(NSNotification *note) {
        Class control = NSClassFromString(@"TunnelControl");
        SEL start = NSSelectorFromString(@"start");
        if (control && [control respondsToSelector:start]) {
            // Silenced because the selector is resolved at runtime by
            // design; the alternative is the generated header this file
            // exists to avoid.
            #pragma clang diagnostic push
            #pragma clang diagnostic ignored "-Warc-performSelector-leaks"
            [control performSelector:start];
            #pragma clang diagnostic pop
        } else {
            NSLog(@"[buddyvpn] TunnelControl is missing; no tunnel requests will be heard");
        }
    }];
}

@end
