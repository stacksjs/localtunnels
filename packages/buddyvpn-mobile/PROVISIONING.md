# Provisioning

How a phone becomes a member of a network, and what it still cannot do about
leaving one.

## What a device needs before it can connect

Three things, and all three now have an answer:

| | where it comes from |
| --- | --- |
| A static keypair | generated on first use, kept in a shared Keychain group (`DeviceIdentity.swift`, `DeviceIdentityStore.swift`) |
| An address, and the exit's key and endpoint | the coordinator, at registration (`CoordinatorClient.swift`) |
| The coordinator's address, and the key to join it | a pairing code shown by the desktop app (`src/pairing.ts`) |

On the desktop the last of those comes from
`~/Library/Application Support/BuddyVPN/servers.json`, written by
`bun run deploy:vpn --region <id>`. A phone has no such file, so the desktop
shows it instead.

## The pairing code

Settings → **Pair a phone** → *Show code*. It encodes a link:

```text
buddyvpn://pair?v=1&c=wss%3A%2F%2Fvpn.example%3A51821&k=<secret>&r=us-west&x=<exit>
```

`x` is the public key of the one server this device will accept, taken from
the region's `useExit` in `servers.json`. It is omitted for `'auto'`, which
is already what a phone does without it.

The app registers the `buddyvpn` scheme, so **the phone's own camera reads
it** and offers to open the app. There is no scanner in this app and no
camera permission: iOS does the reading, and the app only ever sees a URL it
was launched with.

The connect screen takes it from either of the two moments one can arrive —
`getInitialURL` for a code scanned while the app was closed, which is the
common case, and `onLink` for one arriving while it is open. A screen
listening only for the second would work every time except the first, which
is the only time anybody pairs.

Everything in a link is validated rather than trusted. It comes from outside
the app — anyone can put a `buddyvpn://` link in front of somebody — and the
values reach a VPN configuration, so a coordinator URL is a scheme, a host
and an optional port and nothing else: no path, no query, no credentials. An
unrecognised version is refused outright rather than read halfway.

The pairing is kept in the Keychain, not `UserDefaults`, and validated again
on the way out: it outlives app updates, and a format that changed underneath
must not be acted on.

### Where the secret lives

There are two copies of `authKey`, because there are two processes.

The screens keep theirs in Craft's `secureStorage`. The tunnel runs in the
Network Extension, which cannot read that, so the app also writes it to
`PairingSecretStore` — the Keychain access group both targets share, where
the extension reads it. Unpairing clears both; forgetting only the screens'
copy would leave a device still holding the secret it was told to forget.

Neither copy is in the two places a secret should not come to rest. A
`providerConfiguration` travels with the saved VPN profile, outside this
app's Keychain; the dictionary carries the region, the exit address, the
resolvers and the LAN rule, and nothing else. `UserDefaults` is the only
channel a screen has for reaching Swift, so a connect request passes through
it — and `TunnelControl` clears the key before acting on the request, so the
value lives there for one callback rather than until the next connect
replaces it. That is a short window and not no window: a crash inside it
leaves the request on disk, and a plist's freed space is not zeroed.

`packages/buddyvpn/src/pairing.ts` builds the link and
`packages/buddyvpn-mobile/src/pairing.ts` reads it. Two implementations of
one format, so the desktop's builder is imported into the phone's tests and
fed to the phone's parser — the only check that fails if the two drift apart.

## Why it is not simply baked into the build

`authKey` is a secret shared by every member of a network. Anyone holding it
can register, be handed the directory, and advertise themselves as an exit —
a claim the coordinator relays without checking. A secret compiled into a
shipped app belongs to everyone who downloads the app, and rotating it means
shipping a new build to everyone who already had it.

Pinning is what answers the exit half of that. A link that carries `x` names
the one server the device will route through, and it refuses every other one
— including, especially, a peer that advertises more convincingly. When a
pinned server is away the tunnel does not come up, and says so rather than
substituting; the settings row reads *one server* or *any server* so that
refusal is legible. Without a pin, a device takes whichever peer advertises
and sorts smallest, which is a stable choice and not a safe one.

`coordinatorUrl` alone would be harmless to bake. It is not useful alone.

## What a pairing code is, plainly

A shared secret on a screen. Anyone who photographs it joins the network.
That is no worse than `servers.json` on a laptop and no better, which is why
the desktop keeps it behind a button, drops it when the panel closes, and
names the location in the warning every time it is shown.

## What a device can undo

- **Forget the network** (Settings → Network → *Forget*). Removes the
  pairing from this device. With no coordinator there is nothing to connect
  to, so this is the whole of unpairing from the device's side.
- **Reset this device's key** (Settings → This device → *Reset*). A new key
  is a new device to the coordinator: a fresh address, a fresh lease.

Neither reaches the coordinator. It has no notion of revoking one member, so
**anyone still holding the code can still join, and the old key keeps
whatever access it had until somebody removes it on the server.** Both
screens say so next to the button.

## What is still missing

Per-device credentials the coordinator can revoke. Every device on a network
shares one secret today, which means a lost phone cannot be excluded without
rotating the key for everyone and re-pairing each remaining device by hand.

An account service would solve it, and is the shape this ends up in if a
network ever has more than one person on it. It is not built, and nothing
here pretends otherwise: the wording in the app is careful to say what
forgetting and resetting actually do rather than implying they revoke
anything.

## Not yet verified

That a phone's camera reads the code. The payload is tested on both sides,
the encoder is a library, the rendered code has been looked at — but the scan
needs a phone, as does everything else past the Network Extension
entitlement.
