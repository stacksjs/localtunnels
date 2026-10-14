var DEFAULT_REGION = undefined;
var busy = undefined;
var connected = undefined;
var deployed = undefined;
var formatUptime = undefined;
var haptics = undefined;
var here = undefined;
var native = undefined;
var phase = undefined;
var region = undefined;
var regionById = undefined;
var snapshot = undefined;
var statusLabel = undefined;
var stored = undefined;
var toggle = undefined;
var tunnel = undefined;
var whenNativeHost = undefined;
var __stxBundle_6df2d67dc507 = (function() {
var __stxMod0 = globalThis.__stxModules && globalThis.__stxModules["src/native.ts"];
if (__stxMod0 === undefined) throw new Error("[stx] module " + "\"src/native.ts\"" + " is not registered on this page (#1957)");
var haptics = __stxMod0["haptics"];
var whenNativeHost = __stxMod0["whenNativeHost"];
var __stxMod1 = globalThis.__stxModules && globalThis.__stxModules["src/regions.ts"];
if (__stxMod1 === undefined) throw new Error("[stx] module " + "\"src/regions.ts\"" + " is not registered on this page (#1957)");
var DEFAULT_REGION = __stxMod1["DEFAULT_REGION"];
var regionById = __stxMod1["regionById"];
var __stxMod2 = globalThis.__stxModules && globalThis.__stxModules["src/tunnel.ts"];
if (__stxMod2 === undefined) throw new Error("[stx] module " + "\"src/tunnel.ts\"" + " is not registered on this page (#1957)");
var formatUptime = __stxMod2["formatUptime"];
var tunnel = __stxMod2["tunnel"];
// .stx/bundle-tmp/6df2d67dc507-33198-1.ts



var stored = (() => {
  try {
    return window.localStorage?.getItem("buddyvpn.region");
  } catch {
    return null;
  }
})();
var region = state(regionById(stored) ? stored : DEFAULT_REGION);
var snapshot = state(tunnel.snapshot());
var native = state(false);
onMount(() => {
  const stop = tunnel.subscribe((next) => snapshot.set(next));
  whenNativeHost().then((value) => native.set(value));
  return stop;
});
var here = () => regionById(region());
var phase = () => snapshot().phase;
var connected = () => phase() === "connected";
var busy = () => phase() === "connecting" || phase() === "disconnecting";
var deployed = () => Boolean(here()?.exitIp);
var statusLabel = () => {
  if (snapshot().error)
    return "Something went wrong";
  if (phase() === "connecting")
    return "Connecting…";
  if (phase() === "disconnecting")
    return "Disconnecting…";
  return connected() ? "Connected" : "Not connected";
};
var toggle = () => {
  if (busy() || !deployed())
    return;
  haptics.impact("medium");
  if (connected())
    tunnel.disconnect();
  else
    tunnel.connect(region());
};
return { "DEFAULT_REGION": DEFAULT_REGION, "busy": busy, "connected": connected, "deployed": deployed, "formatUptime": formatUptime, "haptics": haptics, "here": here, "native": native, "phase": phase, "region": region, "regionById": regionById, "snapshot": snapshot, "statusLabel": statusLabel, "stored": stored, "toggle": toggle, "tunnel": tunnel, "whenNativeHost": whenNativeHost };
})();
DEFAULT_REGION = __stxBundle_6df2d67dc507["DEFAULT_REGION"];
busy = __stxBundle_6df2d67dc507["busy"];
connected = __stxBundle_6df2d67dc507["connected"];
deployed = __stxBundle_6df2d67dc507["deployed"];
formatUptime = __stxBundle_6df2d67dc507["formatUptime"];
haptics = __stxBundle_6df2d67dc507["haptics"];
here = __stxBundle_6df2d67dc507["here"];
native = __stxBundle_6df2d67dc507["native"];
phase = __stxBundle_6df2d67dc507["phase"];
region = __stxBundle_6df2d67dc507["region"];
regionById = __stxBundle_6df2d67dc507["regionById"];
snapshot = __stxBundle_6df2d67dc507["snapshot"];
statusLabel = __stxBundle_6df2d67dc507["statusLabel"];
stored = __stxBundle_6df2d67dc507["stored"];
toggle = __stxBundle_6df2d67dc507["toggle"];
tunnel = __stxBundle_6df2d67dc507["tunnel"];
whenNativeHost = __stxBundle_6df2d67dc507["whenNativeHost"];