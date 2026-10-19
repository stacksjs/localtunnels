# Provisioning

The phone app can do everything a member of a network does except become one.
This is the gap, and it is a decision rather than an oversight.

## What a device needs before it can connect

Three things. Two are solved:

| | where it comes from |
| --- | --- |
| A static keypair | generated on first use, kept in the Keychain (`DeviceIdentity.swift`) |
| An address, and the exit's key and endpoint | the coordinator, at registration (`CoordinatorClient.swift`) |
| **The coordinator's address, and the key to join it** | **nothing — this is the gap** |

On the desktop both come from
`~/Library/Application Support/BuddyVPN/servers.json`, written by
`bun run deploy:vpn --region <id>`. A phone has no such file and no way to be
handed one.

## Why it is not simply baked into the build

`authKey` is a secret shared by every member of a network. Anyone holding it
can register, be handed the directory, and advertise themselves as an exit —
a claim the coordinator relays without checking. A secret compiled into a
shipped app belongs to everyone who downloads the app, and rotating it means
shipping a new build to everyone who already had it.

`coordinatorUrl` alone would be harmless to bake. It is not useful alone.

## The shape the code already has

`ConnectRequest` carries `coordinatorUrl` and `authKey`, both `null` today,
and `TunnelControl` passes them to the provider through
`providerConfiguration` when they are present. The provider refuses to start
with `notProvisioned` when they are absent. So the channel exists and is
typed; what is missing is something to put in it.

## Options, none of them chosen

- **Pair with the desktop app.** It already holds `servers.json`. A QR code
  on the desktop and a camera on the phone moves both values across without
  either being typed or sent anywhere. Costs a camera permission and a
  pairing screen.
- **A pasted invite.** One opaque token carrying both values, copied from the
  desktop app or from `deploy:vpn` output. No camera, more typing, and
  tokens get forwarded in chat.
- **An account.** The phone signs in and is handed the networks it belongs
  to. The most familiar, and the only one that makes key rotation and
  revoking a lost phone possible — and it means running an account service
  this project does not have.

The first is the smallest thing that is not a compromise. The third is where
this ends up if the app ever has more than one user per network.
