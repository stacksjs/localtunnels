# Changelog

[Compare changes](https://github.com/stacksjs/localtunnels/compare/v0.3.0...v0.3.1)

## ✨ Features

- **buddyvpn**: a menu bar panel beside the window ([6f574cf](https://github.com/stacksjs/localtunnels/commit/6f574cf)) _(by glennmichael123 <gtorregosa@gmail.com>)_ ([#420](https://github.com/stacksjs/localtunnels/issues/420))

## 🐛 Bug Fixes

- **buddyvpn**: do not read location off a window that has none ([e320f26](https://github.com/stacksjs/localtunnels/commit/e320f26)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **buddyvpn**: size the disk image instead of letting hdiutil guess ([00baf5f](https://github.com/stacksjs/localtunnels/commit/00baf5f)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **release**: make room for the disk image before building it ([fa27ad8](https://github.com/stacksjs/localtunnels/commit/fa27ad8)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 📝 Documentation

- **ci**: the disk step did not fix what it claimed to ([addc47b](https://github.com/stacksjs/localtunnels/commit/addc47b)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 💚 Continuous Integration

- build the installer on demand, not only on a tag ([acb4f99](https://github.com/stacksjs/localtunnels/commit/acb4f99)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🔧 Chores

- release v0.3.1 ([d2bb9d8](https://github.com/stacksjs/localtunnels/commit/d2bb9d8)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: pin the craft runtime that has --tray-popover ([0663fe2](https://github.com/stacksjs/localtunnels/commit/0663fe2)) _(by glennmichael123 <gtorregosa@gmail.com>)_ ([#420](https://github.com/stacksjs/localtunnels/issues/420))
- record the 0.3.0 workspace versions in the lockfile ([8941b25](https://github.com/stacksjs/localtunnels/commit/8941b25)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.12...v0.2.13)

## v0.2.13...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.13...main)

### 🚀 Enhancements

- **deploy:** Pick the VPN region with --region, default us-west ([a575a68](https://github.com/stacksjs/localtunnels/commit/a575a68))
- **vpn:** Gate coordinator registration behind an auth key ([95417b3](https://github.com/stacksjs/localtunnels/commit/95417b3))
- **cli:** Vpn:coordinator mints an auth key instead of running open ([95b53c9](https://github.com/stacksjs/localtunnels/commit/95b53c9))
- **vpn:** Extract the TUN bridge and verify inbound sources ([5febc1c](https://github.com/stacksjs/localtunnels/commit/5febc1c))
- **vpn:** Let configureInterface set the MTU ([87d01fe](https://github.com/stacksjs/localtunnels/commit/87d01fe))
- **vpn:** VpnInterface joins a coordinator and carries real traffic ([65099d0](https://github.com/stacksjs/localtunnels/commit/65099d0))
- **cli:** Vpn:up can join a coordinator, and works on macOS ([683a0b7](https://github.com/stacksjs/localtunnels/commit/683a0b7))
- **vpn:** Let a node advertise itself as an exit node ([c116357](https://github.com/stacksjs/localtunnels/commit/c116357))
- **vpn:** Route through a discovered exit node ([23c33ab](https://github.com/stacksjs/localtunnels/commit/23c33ab))
- **cli:** Discover and use an exit node via the coordinator ([991e71b](https://github.com/stacksjs/localtunnels/commit/991e71b))
- **release:** Ship libltvpn beside the CLI in every download ([ee7e695](https://github.com/stacksjs/localtunnels/commit/ee7e695))
- **vpn-app:** The VPN app's own view of the tunnel ([a96a8cf](https://github.com/stacksjs/localtunnels/commit/a96a8cf))
- **vpn-app:** The agent, the launcher and the window ([38ff864](https://github.com/stacksjs/localtunnels/commit/38ff864))
- **vpn-app:** Build the VPN as a self-contained macOS app ([6710f42](https://github.com/stacksjs/localtunnels/commit/6710f42))
- **buddyvpn:** Name the app, and settle its window ([7288fc4](https://github.com/stacksjs/localtunnels/commit/7288fc4))
- **buddyvpn:** Give the app a face ([7c44776](https://github.com/stacksjs/localtunnels/commit/7c44776))
- **buddyvpn:** Make the window clickable before any server exists ([7da10f3](https://github.com/stacksjs/localtunnels/commit/7da10f3))
- **vpn:** Routes, DNS and a kill switch for full-tunnel mode ([72673fa](https://github.com/stacksjs/localtunnels/commit/72673fa))
- **vpn:** Apply full-tunnel mode, and survive not being able to undo it ([38e8fbc](https://github.com/stacksjs/localtunnels/commit/38e8fbc))
- **cli:** Vpn:up --full-tunnel, and vpn:down to undo it ([7f03839](https://github.com/stacksjs/localtunnels/commit/7f03839))
- **buddyvpn:** Connect with the full tunnel and the kill switch on ([f551981](https://github.com/stacksjs/localtunnels/commit/f551981))
- **deploy:** Run a coordinator, so more than one person can connect ([a8f978a](https://github.com/stacksjs/localtunnels/commit/a8f978a))
- **deploy:** Hand the new server straight to BuddyVPN ([0740835](https://github.com/stacksjs/localtunnels/commit/0740835))
- **deploy:** Record the server, and verify via the coordinator ([1fb726d](https://github.com/stacksjs/localtunnels/commit/1fb726d))
- **buddyvpn:** Ask for a password once, not on every connect ([cf0b08f](https://github.com/stacksjs/localtunnels/commit/cf0b08f))
- **vpn:** Notice when the tunnel stops carrying traffic ([4f77586](https://github.com/stacksjs/localtunnels/commit/4f77586))
- **buddyvpn:** Settings, and the location the internet actually sees ([d75d9d4](https://github.com/stacksjs/localtunnels/commit/d75d9d4))
- **buddyvpn:** A settings screen, and the address the internet sees ([aee8396](https://github.com/stacksjs/localtunnels/commit/aee8396))
- **mobile:** Scaffold BuddyVPN for iOS ([a3d63ed](https://github.com/stacksjs/localtunnels/commit/a3d63ed))
- **mobile:** The bridge, the tunnel interface, and a stub behind it ([97aa5b2](https://github.com/stacksjs/localtunnels/commit/97aa5b2))
- **mobile:** The connect screen, the location list, and the button ([6c79283](https://github.com/stacksjs/localtunnels/commit/6c79283))
- **mobile:** The app shell and the phone stylesheet ([0fb966f](https://github.com/stacksjs/localtunnels/commit/0fb966f))
- **mobile:** Compile the screens into the bundle Craft renders ([42be3d8](https://github.com/stacksjs/localtunnels/commit/42be3d8))
- **mobile:** Generate the Xcode project the screens run in ([19df66c](https://github.com/stacksjs/localtunnels/commit/19df66c))
- **mobile:** Open the location list, and make it render ([faeb900](https://github.com/stacksjs/localtunnels/commit/faeb900))
- **mobile:** Emit the packet tunnel provider target ([9ccfae7](https://github.com/stacksjs/localtunnels/commit/9ccfae7))
- **vpn:** Notice when the coordinator has stopped answering ([12283b8](https://github.com/stacksjs/localtunnels/commit/12283b8))
- **vpn:** Surface a stalled coordinator to whoever is watching ([7c60e81](https://github.com/stacksjs/localtunnels/commit/7c60e81))
- **mobile:** The contract between the screens and a real tunnel ([6faff62](https://github.com/stacksjs/localtunnels/commit/6faff62))
- **mobile:** The app half that asks iOS for a tunnel ([6bff406](https://github.com/stacksjs/localtunnels/commit/6bff406))
- **buddyvpn:** The window can tell it has been forgotten ([edc4d9c](https://github.com/stacksjs/localtunnels/commit/edc4d9c))
- **buddyvpn:** Say so in the window when the tunnel is being dropped ([6fef9eb](https://github.com/stacksjs/localtunnels/commit/6fef9eb))
- **mobile:** What a person is allowed to change ([f2850b8](https://github.com/stacksjs/localtunnels/commit/f2850b8))
- **mobile:** A settings screen ([afe36e6](https://github.com/stacksjs/localtunnels/commit/afe36e6))
- **mobile:** Link the VPN core into the tunnel provider ([0d5f676](https://github.com/stacksjs/localtunnels/commit/0d5f676))
- **mobile:** Carry the settings to the provider, and connect on open ([f772808](https://github.com/stacksjs/localtunnels/commit/f772808))
- **mobile:** The tunnel's data path ([23c94d9](https://github.com/stacksjs/localtunnels/commit/23c94d9))
- **mobile:** A coordinator client for the extension ([3a2cfb6](https://github.com/stacksjs/localtunnels/commit/3a2cfb6))
- **mobile:** The device's key, and joining a network with it ([4f26e79](https://github.com/stacksjs/localtunnels/commit/4f26e79))
- The link that hands a network to a phone ([b9d8673](https://github.com/stacksjs/localtunnels/commit/b9d8673))
- **buddyvpn:** Show a pairing code for a phone ([97ea352](https://github.com/stacksjs/localtunnels/commit/97ea352))
- **mobile:** Act on a scanned pairing code ([04b9cc8](https://github.com/stacksjs/localtunnels/commit/04b9cc8))
- **mobile:** Show the paired network, and let a device forget it ([50b648c](https://github.com/stacksjs/localtunnels/commit/50b648c))
- **mobile:** Say why a tunnel will not come up ([3dbfe08](https://github.com/stacksjs/localtunnels/commit/3dbfe08))
- **mobile:** Mark locations this device holds no key for ([4a9a9ac](https://github.com/stacksjs/localtunnels/commit/4a9a9ac))
- **mobile:** The tunnel reports this device's key, and can reset it ([0ee9e05](https://github.com/stacksjs/localtunnels/commit/0ee9e05))
- **mobile:** Show this device's key in settings, and let it be reset ([d367483](https://github.com/stacksjs/localtunnels/commit/d367483))
- **mobile:** The pairing link can name the exit it trusts ([acd60e6](https://github.com/stacksjs/localtunnels/commit/acd60e6))
- **mobile:** Unpairing can reach the copy the tunnel reads ([b23425d](https://github.com/stacksjs/localtunnels/commit/b23425d))
- **vpn:** The coordinator client comes back after a drop ([6a443bd](https://github.com/stacksjs/localtunnels/commit/6a443bd))
- **mobile:** The phone's coordinator client reconnects too ([2ee9e67](https://github.com/stacksjs/localtunnels/commit/2ee9e67))
- **mobile:** The status frame carries how the coordinator is doing ([fc4c42c](https://github.com/stacksjs/localtunnels/commit/fc4c42c))
- **mobile:** Say so when the network has been lost ([62f1b15](https://github.com/stacksjs/localtunnels/commit/62f1b15))
- **mobile:** Carry the coordinator's state across to the app ([2e5f565](https://github.com/stacksjs/localtunnels/commit/2e5f565))
- **mobile:** Play and stop on the button ([bde2729](https://github.com/stacksjs/localtunnels/commit/bde2729))
- **mobile:** Give the app an icon ([5fd4a8d](https://github.com/stacksjs/localtunnels/commit/5fd4a8d))
- **buddyvpn:** A menu bar item, held behind a flag ([35b085e](https://github.com/stacksjs/localtunnels/commit/35b085e))

### 🩹 Fixes

- **docs:** Use the config keys bunpress actually has ([2df2d8f](https://github.com/stacksjs/localtunnels/commit/2df2d8f))
- **cli:** --host was unusable on start, server and vpn:coordinator ([72ce4d7](https://github.com/stacksjs/localtunnels/commit/72ce4d7))
- **vpn:** Compiled binaries could never find libltvpn ([eccfafd](https://github.com/stacksjs/localtunnels/commit/eccfafd))
- **vpn-core:** The library never built for Windows ([d429c47](https://github.com/stacksjs/localtunnels/commit/d429c47))
- **buddyvpn:** Ask the kernel how old the tunnel is ([a73bb55](https://github.com/stacksjs/localtunnels/commit/a73bb55))
- **buddyvpn:** The application menu said craft-runtime ([749693d](https://github.com/stacksjs/localtunnels/commit/749693d))
- **vpn-core:** Zig made X25519 key generation infallible ([7f87a7f](https://github.com/stacksjs/localtunnels/commit/7f87a7f))
- **vpn:** IPv6 walked straight past full-tunnel mode ([79d80c0](https://github.com/stacksjs/localtunnels/commit/79d80c0))
- **deploy:** The auth key was readable by every user on the box ([21eb6b6](https://github.com/stacksjs/localtunnels/commit/21eb6b6))
- **buddyvpn:** The auth key was in the command line on the client too ([3ccfc49](https://github.com/stacksjs/localtunnels/commit/3ccfc49))
- **vpn-core:** The Linux library segfaulted the process that loaded it ([2b2fb81](https://github.com/stacksjs/localtunnels/commit/2b2fb81))
- **deploy:** The exit node published itself at 127.0.0.1 ([af92843](https://github.com/stacksjs/localtunnels/commit/af92843))
- **deploy:** Verify could not reach the endpoint it was told to dial ([5193112](https://github.com/stacksjs/localtunnels/commit/5193112))
- **buddyvpn:** Connect never got as far as asking for a password ([db78804](https://github.com/stacksjs/localtunnels/commit/db78804))
- **buddyvpn:** The tunnel died on nohup, and said it had connected ([c92fe0c](https://github.com/stacksjs/localtunnels/commit/c92fe0c))
- **vpn:** Full tunnel raced the interface, then lied about the result ([481c2ad](https://github.com/stacksjs/localtunnels/commit/481c2ad))
- **buddyvpn:** A lost pid file made a root tunnel unstoppable ([d4a120e](https://github.com/stacksjs/localtunnels/commit/d4a120e))
- **buddyvpn:** Stop gave up when the tunnel ignored SIGTERM ([c77f37a](https://github.com/stacksjs/localtunnels/commit/c77f37a))
- **vpn:** The kill switch wrote literal backslash-n into /etc/pf.conf ([3019f85](https://github.com/stacksjs/localtunnels/commit/3019f85))
- **buddyvpn:** The helper got the CLI without its native library ([7058a5c](https://github.com/stacksjs/localtunnels/commit/7058a5c))
- **vpn:** The kill switch blocked loopback and stranded the machine ([65e0599](https://github.com/stacksjs/localtunnels/commit/65e0599))
- **buddyvpn:** The helper kept running a stale copy of the CLI ([abe2188](https://github.com/stacksjs/localtunnels/commit/abe2188))
- **buddyvpn:** The window could not see the tunnel the helper started ([5ebb861](https://github.com/stacksjs/localtunnels/commit/5ebb861))
- **vpn:** One failed rekey ended the tunnel for good ([f0f8fc6](https://github.com/stacksjs/localtunnels/commit/f0f8fc6))
- **test:** The Linux branch of the kill switch tests was never run ([5ff9da2](https://github.com/stacksjs/localtunnels/commit/5ff9da2))
- **vpn:** An unreachable peer killed the process on Linux ([e9532a0](https://github.com/stacksjs/localtunnels/commit/e9532a0))
- **buddyvpn:** The settings back arrow sat under the traffic lights ([02ee681](https://github.com/stacksjs/localtunnels/commit/02ee681))
- **vpn:** The kill switch cut the tunnel off from its own coordinator ([9b8b3d1](https://github.com/stacksjs/localtunnels/commit/9b8b3d1))
- **vpn:** The coordinator rule matched only a SYN, so it passed nothing ([ad0b16c](https://github.com/stacksjs/localtunnels/commit/ad0b16c))
- **mobile:** The build was calling a working compile a broken one ([6a21ece](https://github.com/stacksjs/localtunnels/commit/6a21ece))
- **mobile:** Bind the screen's text instead of interpolating it ([f6b1915](https://github.com/stacksjs/localtunnels/commit/f6b1915))
- **mobile:** Style the screens the way a native renderer can read ([656e6ef](https://github.com/stacksjs/localtunnels/commit/656e6ef))
- **mobile:** The shield never became a checkmark ([170a892](https://github.com/stacksjs/localtunnels/commit/170a892))
- **mobile:** Re-read the chosen region when the screen comes back ([08de52c](https://github.com/stacksjs/localtunnels/commit/08de52c))
- **mobile:** A tapped location saved nothing and went nowhere ([4718d74](https://github.com/stacksjs/localtunnels/commit/4718d74))
- **mobile:** The picker's title bar read "locations" ([30d71c7](https://github.com/stacksjs/localtunnels/commit/30d71c7))
- **mobile:** The location write goes back through writeRegion ([2830a81](https://github.com/stacksjs/localtunnels/commit/2830a81))
- **mobile:** Typecheck this package at all ([688c1c2](https://github.com/stacksjs/localtunnels/commit/688c1c2))
- **mobile:** The first subscriber got two snapshots for one subscription ([73bfa95](https://github.com/stacksjs/localtunnels/commit/73bfa95))
- **mobile:** NativeTunnel was selected by nothing ([d07ac20](https://github.com/stacksjs/localtunnels/commit/d07ac20))
- **buddyvpn:** A bad patch replaced a chosen resolver with the default ([e27dc38](https://github.com/stacksjs/localtunnels/commit/e27dc38))
- **mobile:** The provider's Swift was never committed ([7f870ae](https://github.com/stacksjs/localtunnels/commit/7f870ae))
- **mobile:** The settings were write-only ([0d4d5df](https://github.com/stacksjs/localtunnels/commit/0d4d5df))
- **buddyvpn:** The egress check answered about the previous route ([74c2f94](https://github.com/stacksjs/localtunnels/commit/74c2f94))
- **mobile:** The screen harness broke CI and I did not look ([f46f03a](https://github.com/stacksjs/localtunnels/commit/f46f03a))
- **mobile:** Compile the screens with the compiler this repo pins ([be8b8db](https://github.com/stacksjs/localtunnels/commit/be8b8db))
- **mobile:** Fail the build when the screens compile inert ([21f6b92](https://github.com/stacksjs/localtunnels/commit/21f6b92))
- **mobile:** <scrollview> resolved to nothing on a case-sensitive disk ([8f3082b](https://github.com/stacksjs/localtunnels/commit/8f3082b))
- **mobile:** The phone delivered padding as part of the packet ([1c3955d](https://github.com/stacksjs/localtunnels/commit/1c3955d))
- **mobile:** Honour the pinned exit, and keep the peers we can read ([2bb204e](https://github.com/stacksjs/localtunnels/commit/2bb204e))
- **mobile:** Derive this device's public key instead of believing it ([fb65f88](https://github.com/stacksjs/localtunnels/commit/fb65f88))
- **mobile:** Keep the join secret out of the plist and the VPN profile ([b489ddf](https://github.com/stacksjs/localtunnels/commit/b489ddf))
- **mobile:** IPv6 went around the tunnel instead of into it ([9470eb3](https://github.com/stacksjs/localtunnels/commit/9470eb3))
- **mobile:** Tell somebody why the tunnel did not come up ([f1aa045](https://github.com/stacksjs/localtunnels/commit/f1aa045))
- **mobile:** The exit shown while connected followed the picker ([7726dff](https://github.com/stacksjs/localtunnels/commit/7726dff))
- **mobile:** The plist asked for ten things we have no feature for ([450e93a](https://github.com/stacksjs/localtunnels/commit/450e93a))
- **mobile:** Stop asking for an App Group nothing opens ([e6a06ef](https://github.com/stacksjs/localtunnels/commit/e6a06ef))
- **vpn:** A dead socket held a node out of its own directory ([777da8e](https://github.com/stacksjs/localtunnels/commit/777da8e))
- **mobile:** Read the link record the host actually sends ([b46fa4e](https://github.com/stacksjs/localtunnels/commit/b46fa4e))
- **mobile:** The checked row follows the tap ([2e7e1fa](https://github.com/stacksjs/localtunnels/commit/2e7e1fa))
- **buddyvpn:** The power button looks clickable under the cursor ([067069b](https://github.com/stacksjs/localtunnels/commit/067069b))
- **buddyvpn:** Every control in the window turns the cursor ([7856e3a](https://github.com/stacksjs/localtunnels/commit/7856e3a))
- **buddyvpn:** The dropdowns keep the arrow ([804fbb5](https://github.com/stacksjs/localtunnels/commit/804fbb5))
- **vpn:** A stall that ends by reconnecting says so ([b4bf4a2](https://github.com/stacksjs/localtunnels/commit/b4bf4a2))
- **buddyvpn:** Quitting the app stops the tunnel ([8cc8d1d](https://github.com/stacksjs/localtunnels/commit/8cc8d1d))

### 💅 Refactors

- **deploy:** Drop the static client config, and stop printing a key ([b48e94d](https://github.com/stacksjs/localtunnels/commit/b48e94d))
- **mobile:** Build the screens from native primitives ([e43b04d](https://github.com/stacksjs/localtunnels/commit/e43b04d))
- Drop two exports nothing reached ([b109f21](https://github.com/stacksjs/localtunnels/commit/b109f21))
- **vpn:** Use the named refusals in the coordinator too ([da458e0](https://github.com/stacksjs/localtunnels/commit/da458e0))

### 📖 Documentation

- Document --region, and say which NATs actually punch through ([a9d459a](https://github.com/stacksjs/localtunnels/commit/a9d459a))
- The npm package does not ship a prebuilt libltvpn ([cdf2d15](https://github.com/stacksjs/localtunnels/commit/cdf2d15))
- .env.example never mentioned the Hetzner token ([fcfabe1](https://github.com/stacksjs/localtunnels/commit/fcfabe1))
- **mobile:** Provisioning is built, so stop describing it as a decision ([db436a0](https://github.com/stacksjs/localtunnels/commit/db436a0))
- **mobile:** The pairing format grew a pin and the secret moved ([57f2d37](https://github.com/stacksjs/localtunnels/commit/57f2d37))

### 🏡 Chore

- Release through @stacksjs/bumpx, not the unrelated npm 'bumpx' ([8de7603](https://github.com/stacksjs/localtunnels/commit/8de7603))
- **buddyvpn:** Turn demo mode off now there is a real server ([439169d](https://github.com/stacksjs/localtunnels/commit/439169d))
- **mobile:** Stop tracking stx's compile cache ([4fc5a75](https://github.com/stacksjs/localtunnels/commit/4fc5a75))
- **buddyvpn:** Typecheck the desktop package too ([067ce0b](https://github.com/stacksjs/localtunnels/commit/067ce0b))
- **mobile:** Stop the xcodegen shim claiming a problem that is fixed ([3571f31](https://github.com/stacksjs/localtunnels/commit/3571f31))
- Stop tracking stx's compile cache at the root ([405ed01](https://github.com/stacksjs/localtunnels/commit/405ed01))
- **release:** Sign the desktop build from an encrypted env file ([e10f4f8](https://github.com/stacksjs/localtunnels/commit/e10f4f8))
- Ignore editor swap files ([5479b59](https://github.com/stacksjs/localtunnels/commit/5479b59))

### ✅ Tests

- **buddyvpn:** Cover the boundary that reaches a root shell ([19fd213](https://github.com/stacksjs/localtunnels/commit/19fd213))
- **vpn:** Wait for the rekey retry instead of timing it ([aaaf3f7](https://github.com/stacksjs/localtunnels/commit/aaaf3f7))
- **mobile:** Run the screens instead of only compiling them ([d59df91](https://github.com/stacksjs/localtunnels/commit/d59df91))
- **mobile:** The harness was blind to anything drawn after hydration ([6df570a](https://github.com/stacksjs/localtunnels/commit/6df570a))
- **mobile:** The two lists kept in two places now say when they drift ([5c9e62e](https://github.com/stacksjs/localtunnels/commit/5c9e62e))
- **mobile:** Pin the Craft bridge these screens assume ([330089b](https://github.com/stacksjs/localtunnels/commit/330089b))

### 🤖 CI

- **release:** Attach BuddyVPN's installer to the GitHub release ([1f7baa3](https://github.com/stacksjs/localtunnels/commit/1f7baa3))
- Pin the pantry action, and call it by its current name ([1d82e6c](https://github.com/stacksjs/localtunnels/commit/1d82e6c))
- Add buddy-bot, the updater CLAUDE.md already names ([e75f840](https://github.com/stacksjs/localtunnels/commit/e75f840))
- Keep buddy-bot off the workflow files until it can write them ([104ea91](https://github.com/stacksjs/localtunnels/commit/104ea91))

### ❤️ Contributors

- Glennmichael123 ([@glennmichael123](https://github.com/glennmichael123))
- Chris <chrisbreuer93@gmail.com>

## 🐛 Bug Fixes

- **vpn**: survive zig master's Optimize field rename ([e535064](https://github.com/stacksjs/localtunnels/commit/e535064)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: demote @stacksjs/ts-analytics to a devDependency ([3aabc4f](https://github.com/stacksjs/localtunnels/commit/3aabc4f)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧹 Chores

- release v0.2.13 ([2ec22e8](https://github.com/stacksjs/localtunnels/commit/2ec22e8)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.11...v0.2.12)

## ⚡ Performance Improvements

- compile tunnel servers for production ([9fab579](https://github.com/stacksjs/localtunnels/commit/9fab579)) _(by Chris <chrisbreuer93@gmail.com>)_

## 📦 Build System

- use Bun production mode ([a2ab9b5](https://github.com/stacksjs/localtunnels/commit/a2ab9b5)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.2.12 ([5c6e1aa](https://github.com/stacksjs/localtunnels/commit/5c6e1aa)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_

[Compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.10...v0.2.11)

## 🐛 Bug Fixes

- **pkg**: drop sideEffects:false, it emits a broken dist ([3d70a64](https://github.com/stacksjs/localtunnels/commit/3d70a64)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.2.11 ([2bdc13f](https://github.com/stacksjs/localtunnels/commit/2bdc13f)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_

[Compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.9...v0.2.10)

## 🐛 Bug Fixes

- **test**: scope the test run to this repo's packages ([7fe130a](https://github.com/stacksjs/localtunnels/commit/7fe130a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **pkg**: drop bun→src export condition, stop shipping src ([abf4fa8](https://github.com/stacksjs/localtunnels/commit/abf4fa8)) _(by Chris <chrisbreuer93@gmail.com>)_

## 📚 Documentation

- link the community as stacksjs.com/discord ([b6de7f7](https://github.com/stacksjs/localtunnels/commit/b6de7f7)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.2.10 ([d0fe6a9](https://github.com/stacksjs/localtunnels/commit/d0fe6a9)) _(by Chris <chrisbreuer93@gmail.com>)_
- release v0.2.9 ([2c899f5](https://github.com/stacksjs/localtunnels/commit/2c899f5)) _(by Chris <chrisbreuer93@gmail.com>)_
- **release**: add a non-interactive release:patch script ([b76c3c3](https://github.com/stacksjs/localtunnels/commit/b76c3c3)) _(by Chris <chrisbreuer93@gmail.com>)_
- **pkg**: add sideEffects:false to localtunnels (publint) ([d3567c2](https://github.com/stacksjs/localtunnels/commit/d3567c2)) _(by Chris <chrisbreuer93@gmail.com>)_
- release v0.2.8 ([849a4ec](https://github.com/stacksjs/localtunnels/commit/849a4ec)) _(by Chris <chrisbreuer93@gmail.com>)_
- upgrade to TypeScript 7 ([f649f10](https://github.com/stacksjs/localtunnels/commit/f649f10)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.37 ([b8e7814](https://github.com/stacksjs/localtunnels/commit/b8e7814)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.8...v0.2.9)

## 🐛 Bug Fixes

- **pkg**: drop bun→src export condition, stop shipping src ([bee5808](https://github.com/stacksjs/localtunnels/commit/bee5808)) _(by Chris <chrisbreuer93@gmail.com>)_

## 📚 Documentation

- link the community as stacksjs.com/discord ([b22163a](https://github.com/stacksjs/localtunnels/commit/b22163a)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.2.9 ([9c4e83f](https://github.com/stacksjs/localtunnels/commit/9c4e83f)) _(by Chris <chrisbreuer93@gmail.com>)_
- **release**: add a non-interactive release:patch script ([474cf2f](https://github.com/stacksjs/localtunnels/commit/474cf2f)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: bump @stacksjs/ts-cloud to ^0.7.26 ([cff1b35](https://github.com/stacksjs/localtunnels/commit/cff1b35)) _(by Chris <chrisbreuer93@gmail.com>)_
- **pkg**: add sideEffects:false to localtunnels (publint) ([957933c](https://github.com/stacksjs/localtunnels/commit/957933c)) _(by Chris <chrisbreuer93@gmail.com>)_
- upgrade to TypeScript 7 ([bed975a](https://github.com/stacksjs/localtunnels/commit/bed975a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.37 ([7d43438](https://github.com/stacksjs/localtunnels/commit/7d43438)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- release v0.2.8 ([462fff0](https://github.com/stacksjs/localtunnels/commit/462fff0)) _(by Chris <chrisbreuer93@gmail.com>)_
- upgrade to TypeScript 7 ([5e4ba88](https://github.com/stacksjs/localtunnels/commit/5e4ba88)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.7...v0.2.8)

## 💥 Breaking Changes

- refactor!: convert to a bun-workspaces monorepo; provision deploys via ts-cloud ([35449b6](https://github.com/stacksjs/localtunnels/commit/35449b6)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🚀 Features

- **vpn-core**: ABI v4 — null-safe FFI surface and send-counter export ([806eac9](https://github.com/stacksjs/localtunnels/commit/806eac9)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: make transport sessions and handshake state thread-safe ([2786130](https://github.com/stacksjs/localtunnels/commit/2786130)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deploy**: VPN deploy takes --provider hetzner ([0bdd9ab](https://github.com/stacksjs/localtunnels/commit/0bdd9ab)) _(by aws <Chris>)_
- **cloud**: deploy the tunnel server to Hetzner with --provider hetzner ([29faae2](https://github.com/stacksjs/localtunnels/commit/29faae2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **tunnel**: binary-safe transport, fail-fast errors, and forwarded headers ([8830d1d](https://github.com/stacksjs/localtunnels/commit/8830d1d)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deploy**: run the localtunnels VPN (not stock WireGuard) on Hetzner ([7698fe8](https://github.com/stacksjs/localtunnels/commit/7698fe8)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deploy**: self-hosted WireGuard VPN on Hetzner via ts-cloud ([e0ebc51](https://github.com/stacksjs/localtunnels/commit/e0ebc51)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: M10 — IPv6, exit-node routing, raw WireGuard transport, Windows ([80724e6](https://github.com/stacksjs/localtunnels/commit/80724e6)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: wire-correctness KATs and relay fallback for symmetric NAT ([c30e4d8](https://github.com/stacksjs/localtunnels/commit/c30e4d8)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: NAT traversal via UDP hole punching ([3fd9c25](https://github.com/stacksjs/localtunnels/commit/3fd9c25)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: session lifecycle (rekey, cookie/mac2, allowed-ips) and native pump ([c1cffd8](https://github.com/stacksjs/localtunnels/commit/c1cffd8)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: peer coordination and auto-discovered encrypted mesh ([6bc0d8d](https://github.com/stacksjs/localtunnels/commit/6bc0d8d)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: native TUN device support and `lt vpn up` bridge ([d633bea](https://github.com/stacksjs/localtunnels/commit/d633bea)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: userspace UDP datapath with end-to-end encrypted transport ([5f8fe62](https://github.com/stacksjs/localtunnels/commit/5f8fe62)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: WireGuard-style encrypted core with a Zig native datapath ([d8d8d83](https://github.com/stacksjs/localtunnels/commit/d8d8d83)) _(by Chris <chrisbreuer93@gmail.com>)_
- on-demand TLS check endpoint + typed event emitters ([1794767](https://github.com/stacksjs/localtunnels/commit/1794767)) _(by Chris <chrisbreuer93@gmail.com>)_
- add deploy-site CI workflow for auto-deploying marketing site ([8450dd3](https://github.com/stacksjs/localtunnels/commit/8450dd3)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🐛 Bug Fixes

- **pkg**: drop bun→src export condition, stop shipping src ([bee5808](https://github.com/stacksjs/localtunnels/commit/bee5808)) _(by Chris <chrisbreuer93@gmail.com>)_
- **client**: verify server TLS cert on the DNS-bypass path instead of skipping it ([4f26121](https://github.com/stacksjs/localtunnels/commit/4f26121)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deploy**: scope SSH, harden cloud-init installers, keep secrets out of the unit ([dfc3163](https://github.com/stacksjs/localtunnels/commit/dfc3163)) _(by Chris <chrisbreuer93@gmail.com>)_
- **cli**: don't let a failed disconnect hang shutdown as an unhandled rejection ([6dc89e6](https://github.com/stacksjs/localtunnels/commit/6dc89e6)) _(by Chris <chrisbreuer93@gmail.com>)_
- **tunnel**: build websocket control frames with JSON.stringify ([4cf563a](https://github.com/stacksjs/localtunnels/commit/4cf563a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: bound datagram DataViews so short packets can't read out of bounds ([05f8720](https://github.com/stacksjs/localtunnels/commit/05f8720)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: TUN reads no longer silently drop or truncate packets ([5d92472](https://github.com/stacksjs/localtunnels/commit/5d92472)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: one-shot key derivation and fail-closed session lifecycle ([27b76ef](https://github.com/stacksjs/localtunnels/commit/27b76ef)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: REJECT_AFTER_MESSAGES off-by-one and FFI-input hardening ([cc6c16a](https://github.com/stacksjs/localtunnels/commit/cc6c16a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: handle macOS utun AF framing in the packet pump ([4fab5fe](https://github.com/stacksjs/localtunnels/commit/4fab5fe)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: mint DoS cookies from a private rotating secret, not public data ([c6babdb](https://github.com/stacksjs/localtunnels/commit/c6babdb)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: stage handshake state and commit only after full authentication ([1e28995](https://github.com/stacksjs/localtunnels/commit/1e28995)) _(by Chris <chrisbreuer93@gmail.com>)_
- **ci**: deploy docs from dist/.bunpress (bunpress build output) ([6654754](https://github.com/stacksjs/localtunnels/commit/6654754)) _(by Chris <chrisbreuer93@gmail.com>)_
- **build**: emit declarations and JS for every exports subpath ([7ff2671](https://github.com/stacksjs/localtunnels/commit/7ff2671)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: retry getrandom on EINTR instead of failing key generation ([4d4fff1](https://github.com/stacksjs/localtunnels/commit/4d4fff1)) _(by Chris <chrisbreuer93@gmail.com>)_
- **tls**: approve www host in on-demand TLS check ([65d6019](https://github.com/stacksjs/localtunnels/commit/65d6019)) _(by Chris <chrisbreuer93@gmail.com>)_
- **server**: wire --domain into TunnelServer ([2fcf127](https://github.com/stacksjs/localtunnels/commit/2fcf127)) _(by Chris <chrisbreuer93@gmail.com>)_
- add setup-bun to publish-commit job ([252f831](https://github.com/stacksjs/localtunnels/commit/252f831)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- normalize actions/checkout version tags ([963539b](https://github.com/stacksjs/localtunnels/commit/963539b)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- use correct bunpress output path in deploy-site workflow ([00ecf51](https://github.com/stacksjs/localtunnels/commit/00ecf51)) _(by Chris <chrisbreuer93@gmail.com>)_
- externalize ts-analytics in build and compile scripts ([39be331](https://github.com/stacksjs/localtunnels/commit/39be331)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## ⚡ Performance Improvements

- **vpn-core**: ship the native library as ReleaseFast by default ([c665617](https://github.com/stacksjs/localtunnels/commit/c665617)) _(by Chris <chrisbreuer93@gmail.com>)_

## 📚 Documentation

- document VPN mode, deployment, and the hardened HTTP tunnel ([bd86ce9](https://github.com/stacksjs/localtunnels/commit/bd86ce9)) _(by Chris <chrisbreuer93@gmail.com>)_
- self-hosting is capability-first — tunnel server and VPN on either provider ([cb54c46](https://github.com/stacksjs/localtunnels/commit/cb54c46)) _(by Chris <chrisbreuer93@gmail.com>)_
- reflect multi-provider IaC deploys (AWS + Hetzner via ts-cloud) ([f39250c](https://github.com/stacksjs/localtunnels/commit/f39250c)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: document VPN mode; ship native source and add build scripts ([3f6a533](https://github.com/stacksjs/localtunnels/commit/3f6a533)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧪 Tests

- **vpn-core**: transport data-message known-answer vectors ([30cf3f2](https://github.com/stacksjs/localtunnels/commit/30cf3f2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: fuzz tests, real-socket pump test, root TUN e2e, and CI ([5ce503e](https://github.com/stacksjs/localtunnels/commit/5ce503e)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🤖 Continuous Integration

- **release**: gate npm publish on typecheck and tests ([29f7e48](https://github.com/stacksjs/localtunnels/commit/29f7e48)) _(by Chris <chrisbreuer93@gmail.com>)_
- fix zig 0.17 test build; gate pantry publish-commit on repo variable ([6599f7e](https://github.com/stacksjs/localtunnels/commit/6599f7e)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: run the full test suite in the VPN e2e job ([a3e0b6b](https://github.com/stacksjs/localtunnels/commit/a3e0b6b)) _(by Chris <chrisbreuer93@gmail.com>)_
- drop redundant setup-bun (pantry installs bun via deps.yaml) ([3cd082c](https://github.com/stacksjs/localtunnels/commit/3cd082c)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧹 Chores

- release v0.2.8 ([7715e29](https://github.com/stacksjs/localtunnels/commit/7715e29)) _(by Chris <chrisbreuer93@gmail.com>)_
- upgrade to TypeScript 7 ([5e4ba88](https://github.com/stacksjs/localtunnels/commit/5e4ba88)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: keygen retry, shared protocol constants, boundary test ([ae5610d](https://github.com/stacksjs/localtunnels/commit/ae5610d)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: pin pickier ^0.1.37 (markdown fenced-code autofix fix) ([ef953f2](https://github.com/stacksjs/localtunnels/commit/ef953f2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: bump @stacksjs/ts-cloud to ^0.7.7 ([769950c](https://github.com/stacksjs/localtunnels/commit/769950c)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.35 ([79f5f67](https://github.com/stacksjs/localtunnels/commit/79f5f67)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.33 ([7432fba](https://github.com/stacksjs/localtunnels/commit/7432fba)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up @stacksjs/logsmith 0.2.3 ([0522a6c](https://github.com/stacksjs/localtunnels/commit/0522a6c)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up buddy-bot 0.9.20 ([d62c0e7](https://github.com/stacksjs/localtunnels/commit/d62c0e7)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: bump better-dx to ^0.2.15 ([e63fa66](https://github.com/stacksjs/localtunnels/commit/e63fa66)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock to pick up bun-plugin-dtsx@0.9.18 ([61c5976](https://github.com/stacksjs/localtunnels/commit/61c5976)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock and apply pickier --fix ([3970e32](https://github.com/stacksjs/localtunnels/commit/3970e32)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock ([5efb7a7](https://github.com/stacksjs/localtunnels/commit/5efb7a7)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock to pick up latest pickier ([dc92297](https://github.com/stacksjs/localtunnels/commit/dc92297)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fresh install to pick up dtsx 0.9.14 and bunfig 0.15.9 ([83d15d1](https://github.com/stacksjs/localtunnels/commit/83d15d1)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fix CI errors ([e3efc9e](https://github.com/stacksjs/localtunnels/commit/e3efc9e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fix lint errors ([6af980e](https://github.com/stacksjs/localtunnels/commit/6af980e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fresh install to pick up pickier 0.1.21 ([4dab815](https://github.com/stacksjs/localtunnels/commit/4dab815)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- auto-fix lint errors ([683109f](https://github.com/stacksjs/localtunnels/commit/683109f)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- include md in pickier lint extensions ([c796f57](https://github.com/stacksjs/localtunnels/commit/c796f57)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update vscode config ([c5ca005](https://github.com/stacksjs/localtunnels/commit/c5ca005)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update dependencies ([3d3312c](https://github.com/stacksjs/localtunnels/commit/3d3312c)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- repo cleanup and modernization ([0bfc760](https://github.com/stacksjs/localtunnels/commit/0bfc760)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([1f24b1c](https://github.com/stacksjs/localtunnels/commit/1f24b1c)) _(by Chris <chrisbreuer93@gmail.com>)_
- use Pantry action for publish-commit and add job dependencies ([d1b8b86](https://github.com/stacksjs/localtunnels/commit/d1b8b86)) _(by Chris <chrisbreuer93@gmail.com>)_
- remove file ignores from pickier config ([fa55888](https://github.com/stacksjs/localtunnels/commit/fa55888)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- add CLAUDE.md and CHANGELOG.md to pickier ignores ([cd23db7](https://github.com/stacksjs/localtunnels/commit/cd23db7)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- remove .pickierignore ([6694f07](https://github.com/stacksjs/localtunnels/commit/6694f07)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update better-dx to ^0.2.7 ([e2cbb29](https://github.com/stacksjs/localtunnels/commit/e2cbb29)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- enrich CLAUDE.md with detailed project context from README ([4990f26](https://github.com/stacksjs/localtunnels/commit/4990f26)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update CLAUDE.md with project context and crosswind details ([0daf0a6](https://github.com/stacksjs/localtunnels/commit/0daf0a6)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- add proper claude code guidelines ([9939aeb](https://github.com/stacksjs/localtunnels/commit/9939aeb)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- use pantry monorepo action instead of pantry-setup ([3132a5f](https://github.com/stacksjs/localtunnels/commit/3132a5f)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- ignore claude config in linter ([2b44318](https://github.com/stacksjs/localtunnels/commit/2b44318)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- add claude code guidelines ([684cd20](https://github.com/stacksjs/localtunnels/commit/684cd20)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fix ts-analytics dep to github ref and update CI actions ([872b153](https://github.com/stacksjs/localtunnels/commit/872b153)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([efe5c61](https://github.com/stacksjs/localtunnels/commit/efe5c61)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([deb9e50](https://github.com/stacksjs/localtunnels/commit/deb9e50)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([85db325](https://github.com/stacksjs/localtunnels/commit/85db325)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([288b8da](https://github.com/stacksjs/localtunnels/commit/288b8da)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([eaf3dec](https://github.com/stacksjs/localtunnels/commit/eaf3dec)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([67edb0d](https://github.com/stacksjs/localtunnels/commit/67edb0d)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([323c24f](https://github.com/stacksjs/localtunnels/commit/323c24f)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([2f5f05e](https://github.com/stacksjs/localtunnels/commit/2f5f05e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([6dd6733](https://github.com/stacksjs/localtunnels/commit/6dd6733)) _(by Chris <chrisbreuer93@gmail.com>)_

## ⏪ Reverts

- keep staged-lint kebab + bunx gitlint shorthand ([255e042](https://github.com/stacksjs/localtunnels/commit/255e042)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _aws <Chris>_
- _glennmichael123 <gtorregosa@gmail.com>_

## v0.2.6...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.6...main)

### 🚀 Enhancements

- Add `manageHosts` ([46ddef0](https://github.com/stacksjs/localtunnels/commit/46ddef0))

### 🏡 Chore

- Update docs ([1d7ca85](https://github.com/stacksjs/localtunnels/commit/1d7ca85))
- Add bun exports ([df53461](https://github.com/stacksjs/localtunnels/commit/df53461))
- Wip ([f6f7d23](https://github.com/stacksjs/localtunnels/commit/f6f7d23))
- Wip ([fac7dcd](https://github.com/stacksjs/localtunnels/commit/fac7dcd))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.2.5...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.5...main)

### 🏡 Chore

- Wip ([886f095](https://github.com/stacksjs/localtunnels/commit/886f095))
- Wip ([e0fd2c6](https://github.com/stacksjs/localtunnels/commit/e0fd2c6))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.2.3...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.3...main)

### 🏡 Chore

- Fix unused variable lint errors ([da0a2c0](https://github.com/stacksjs/localtunnels/commit/da0a2c0))
- Wip ([99835af](https://github.com/stacksjs/localtunnels/commit/99835af))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))
- Glennmichael123 ([@glennmichael123](https://github.com/glennmichael123))

## v0.2.2...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.2...main)

### 🏡 Chore

- Wip ([c8ac58c](https://github.com/stacksjs/localtunnels/commit/c8ac58c))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.2.1...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.1...main)

### 🏡 Chore

- Wip ([cf6ee5c](https://github.com/stacksjs/localtunnels/commit/cf6ee5c))
- Wip ([5f971c9](https://github.com/stacksjs/localtunnels/commit/5f971c9))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.2.1...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.1...main)

### 🏡 Chore

- Wip ([cf6ee5c](https://github.com/stacksjs/localtunnels/commit/cf6ee5c))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.2.1...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.1...main)

### 🏡 Chore

- Wip ([cf6ee5c](https://github.com/stacksjs/localtunnels/commit/cf6ee5c))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.1.1...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.1.1...main)

### 🚀 Enhancements

- New release script using pantry ([#23](https://github.com/stacksjs/localtunnels/pull/23))

### 📖 Documentation

- Add analytics ([5b6fbd3](https://github.com/stacksjs/localtunnels/commit/5b6fbd3))
- Added install, usage and intro ([30f980b](https://github.com/stacksjs/localtunnels/commit/30f980b))
- Added unconfig override ([e541aa3](https://github.com/stacksjs/localtunnels/commit/e541aa3))
- Fix typo on dowload version ([7728788](https://github.com/stacksjs/localtunnels/commit/7728788))
- Enhance docs ([3e87a6b](https://github.com/stacksjs/localtunnels/commit/3e87a6b))
- Fix build error ([ec61ff5](https://github.com/stacksjs/localtunnels/commit/ec61ff5))
- Update code theme ([ad6e05d](https://github.com/stacksjs/localtunnels/commit/ad6e05d))
- Improve showcase ([0d1c46a](https://github.com/stacksjs/localtunnels/commit/0d1c46a))
- Improve showcase ([7bc6d33](https://github.com/stacksjs/localtunnels/commit/7bc6d33))
- Improve sponsors ([2c135c0](https://github.com/stacksjs/localtunnels/commit/2c135c0))

### 🏡 Chore

- Improve docs ([903f2db](https://github.com/stacksjs/localtunnels/commit/903f2db))
- Enhance docs ([b82f13c](https://github.com/stacksjs/localtunnels/commit/b82f13c))
- Enhance team member css ([4e4d3a1](https://github.com/stacksjs/localtunnels/commit/4e4d3a1))
- Fix lint issue ([0e0fbb7](https://github.com/stacksjs/localtunnels/commit/0e0fbb7))
- Enhance css ([ce26081](https://github.com/stacksjs/localtunnels/commit/ce26081))
- Enhance team description ([f9de86c](https://github.com/stacksjs/localtunnels/commit/f9de86c))
- Update bunfig & use text lock file ([e965db5](https://github.com/stacksjs/localtunnels/commit/e965db5))
- Pin unconfig ([9c7471b](https://github.com/stacksjs/localtunnels/commit/9c7471b))
- Adjust uno version ([ceb0121](https://github.com/stacksjs/localtunnels/commit/ceb0121))
- Revert unconfig ([c4c9491](https://github.com/stacksjs/localtunnels/commit/c4c9491))
- Several minor adjustments ([b8e2dd9](https://github.com/stacksjs/localtunnels/commit/b8e2dd9))
- Update renovate config ([1ba7a55](https://github.com/stacksjs/localtunnels/commit/1ba7a55))
- Improve sponsor.md ([b1e61d9](https://github.com/stacksjs/localtunnels/commit/b1e61d9))
- Add github funding info ([4a4d343](https://github.com/stacksjs/localtunnels/commit/4a4d343))
- Sponsor changes ([dcbd02f](https://github.com/stacksjs/localtunnels/commit/dcbd02f))
- Enhnace dictionary ([2e3b88d](https://github.com/stacksjs/localtunnels/commit/2e3b88d))
- Enhance funding ([05541a6](https://github.com/stacksjs/localtunnels/commit/05541a6))
- Add stacksjs/docs and cursor rules ([e6a75ac](https://github.com/stacksjs/localtunnels/commit/e6a75ac))
- Sponsors changes and stargazers ([81a3c74](https://github.com/stacksjs/localtunnels/commit/81a3c74))
- Improve docs and add  bun-git-hooks with gitlint ([564f3e7](https://github.com/stacksjs/localtunnels/commit/564f3e7))
- Add clarity and improve logging ([d246389](https://github.com/stacksjs/localtunnels/commit/d246389))
- Wip ([01b18e0](https://github.com/stacksjs/localtunnels/commit/01b18e0))
- Wip ([1f8fe63](https://github.com/stacksjs/localtunnels/commit/1f8fe63))
- Wip ([40f9ec5](https://github.com/stacksjs/localtunnels/commit/40f9ec5))
- Wip ([0c31f98](https://github.com/stacksjs/localtunnels/commit/0c31f98))
- Wip ([f37763b](https://github.com/stacksjs/localtunnels/commit/f37763b))
- Update cover & og-image ([7f40857](https://github.com/stacksjs/localtunnels/commit/7f40857))
- Wip ([fe6627b](https://github.com/stacksjs/localtunnels/commit/fe6627b))
- Wip ([78677b3](https://github.com/stacksjs/localtunnels/commit/78677b3))
- Wip ([603f7d9](https://github.com/stacksjs/localtunnels/commit/603f7d9))
- Wip ([e13fbb3](https://github.com/stacksjs/localtunnels/commit/e13fbb3))
- Wip ([24ff40c](https://github.com/stacksjs/localtunnels/commit/24ff40c))
- Wip ([e4e95af](https://github.com/stacksjs/localtunnels/commit/e4e95af))
- Wip ([54a3f25](https://github.com/stacksjs/localtunnels/commit/54a3f25))
- Wip ([8f04ac8](https://github.com/stacksjs/localtunnels/commit/8f04ac8))
- Wip ([86cda8a](https://github.com/stacksjs/localtunnels/commit/86cda8a))
- Wip ([b7e3ca5](https://github.com/stacksjs/localtunnels/commit/b7e3ca5))
- Wip ([1a6429a](https://github.com/stacksjs/localtunnels/commit/1a6429a))
- Wip ([f946e89](https://github.com/stacksjs/localtunnels/commit/f946e89))
- Wip ([65f8956](https://github.com/stacksjs/localtunnels/commit/65f8956))
- Wip ([213a2aa](https://github.com/stacksjs/localtunnels/commit/213a2aa))
- Wip ([360355c](https://github.com/stacksjs/localtunnels/commit/360355c))
- Wip ([d821e31](https://github.com/stacksjs/localtunnels/commit/d821e31))
- Wip ([7f97109](https://github.com/stacksjs/localtunnels/commit/7f97109))
- Wip ([367eda9](https://github.com/stacksjs/localtunnels/commit/367eda9))
- Wip ([a94f94a](https://github.com/stacksjs/localtunnels/commit/a94f94a))
- Wip ([bcbb8ab](https://github.com/stacksjs/localtunnels/commit/bcbb8ab))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))
- Glennmichael123 ([@glennmichael123](https://github.com/glennmichael123))
- Glenn Michael Torregosa ([@glennmichael123](https://github.com/glennmichael123))
- Cab-mikee ([@cab-mikee](https://github.com/cab-mikee))

## v0.1.0...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.1.0...main)

### 🏡 Chore

- Minor adjustments ([980d404](https://github.com/stacksjs/localtunnels/commit/980d404))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## ...main

### 🏡 Chore

- Initial commit ([75da79b](https://github.com/stacksjs/localtunnels/commit/75da79b))
- Wip ([6f98794](https://github.com/stacksjs/localtunnels/commit/6f98794))
- Add initial cloud ([c48fbef](https://github.com/stacksjs/localtunnels/commit/c48fbef))
- Update readme ([6d43613](https://github.com/stacksjs/localtunnels/commit/6d43613))
- Rename to lpx ([4119499](https://github.com/stacksjs/localtunnels/commit/4119499))
- Lint ([594c7cb](https://github.com/stacksjs/localtunnels/commit/594c7cb))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))
