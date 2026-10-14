# Screens

Compiled by `bun run build:web` into `dist/native-screens.js`, the
JavaScriptCore bundle Craft renders. This is stx's **native** renderer: a
`<button>` here becomes a UIKit `Button`, not an HTML element. That is the
difference between a phone app and a website in a wrapper.

```text
screens/      one file per route; the filename is the route name
components/   shared pieces (ConnectButton)
layouts/      the frame (app)
```

`native.config.json` maps routes to screens and is **generated** by the build
from this directory. Do not edit it: a hand-kept copy stops matching the
moment a screen is added, and the build would succeed with the new screen
simply absent from the app.

## Known gap: directives are not compiling to native behaviour

The build currently reports eight of these:

```text
warning: dropped-subtree: script
warning: unread-event: p: @if
warning: unread-event: li: @for
```

They are connected. The native compiler drops `<script client>` (first
warning), so by the time it reaches `@if(locked())` the symbols that
expression needs do not exist — the directive is left on the element as an
attribute it cannot read, which is what `unread-event` means.

The consequence is specific, and worth stating plainly: **those controls
render, and do not react.** The location list draws, the conditional banners
draw, and neither responds to state. The bundle builds and the app would
launch looking right.

What this means in practice:

- the screens are correct as a description of the interface
- they are not yet correct as a native application
- the fix is in how state reaches a native screen, not in the markup

The webview renderer takes `<script client>` as written — the desktop app
works that way. The native renderer wants setup delivered through the bundle's
own entry (`__stx_latestSetup`) instead. Resolving that is the next piece of
work, and until it is resolved nobody should read a screenshot of this app as
evidence that it functions.

## Why there is no tunnel behind any of it

See `mobile.config.ts`. An iOS app reaches the network stack only through a
Network Extension, and a custom protocol needs an entitlement Apple grants by
request. `src/tunnel.ts` is the interface the screens use; `StubTunnel` walks
every state without moving a packet, and says `simulated: true` on every
snapshot so no screen can forget to say so.
