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

## What the build's warnings mean

The build prints warnings like these, and they are expected:

```text
warning: dropped-subtree: script
warning: unread-event: p: @if
warning: unread-event: li: @for
```

An earlier version of this file read them as a defect and said the screens
"render and do not react". That was wrong, and the mistake is worth keeping
written down because the warning text invites it.

Both come from passes that are not the one that matters:

- `dropped-subtree: script` is stx's own description of deliberate
  behaviour — "deliberately not translated: a script". The script is not
  lost; it is lifted into a `__stx_setup_*` function carried by the bundle's
  entry, which is where a native screen's state is supposed to come from.
- `unread-event` comes from the translator's attribute pass, which maps `@x`
  onto a native event. `@if` and `@for` are not events, so that pass declines
  them. It runs *after* `extractBindingManifest` has already claimed the same
  attributes as `if` and `for` bindings, and the manifest is what the runtime
  hydrates from.

What actually reaches the device is `document + manifest + setup`, handed to
`prepareSharedNativeScreen`. The build asserts that now rather than inferring
it, and reports what it found:

```text
[mobile] bindings: 2 attr, 7 if, 2 event, 2 for
```

It fails outright if the bundle carries no setup function, since
`__stx_latestSetup = null` is the one state that really would leave every
screen inert — and stx still emits a bundle in that case.

## What is still unverified

The bundle contains the right things. Nobody has run it. There is no Xcode
project yet, so the screens have never been drawn on a device or a simulator,
and no claim here should be read as saying they have.

## Why there is no tunnel behind any of it

See `mobile.config.ts`. An iOS app reaches the network stack only through a
Network Extension, and a custom protocol needs an entitlement Apple grants by
request. `src/tunnel.ts` is the interface the screens use; `StubTunnel` walks
every state without moving a packet, and says `simulated: true` on every
snapshot so no screen can forget to say so.
