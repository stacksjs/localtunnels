//
//  What the provider can call from Swift.
//
//  libltvpn is a static archive built from `packages/vpn-core` by
//  `scripts/build-core-ios.ts`. Swift reaches C through a bridging header,
//  and this is the whole of it: one include, because the library's surface is
//  already described in one place and repeating any of it here would be a
//  second copy to keep in step.
//
#import "ltvpn.h"
