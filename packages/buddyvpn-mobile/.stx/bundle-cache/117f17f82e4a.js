var REGIONS = undefined;
var choose = undefined;
var haptics = undefined;
var locked = undefined;
var snapshot = undefined;
var tunnel = undefined;
var __stxBundle_117f17f82e4a = (function() {
var __stxMod0 = globalThis.__stxModules && globalThis.__stxModules["src/native.ts"];
if (__stxMod0 === undefined) throw new Error("[stx] module " + "\"src/native.ts\"" + " is not registered on this page (#1957)");
var haptics = __stxMod0["haptics"];
var __stxMod1 = globalThis.__stxModules && globalThis.__stxModules["src/regions.ts"];
if (__stxMod1 === undefined) throw new Error("[stx] module " + "\"src/regions.ts\"" + " is not registered on this page (#1957)");
var REGIONS = __stxMod1["REGIONS"];
var __stxMod2 = globalThis.__stxModules && globalThis.__stxModules["src/tunnel.ts"];
if (__stxMod2 === undefined) throw new Error("[stx] module " + "\"src/tunnel.ts\"" + " is not registered on this page (#1957)");
var tunnel = __stxMod2["tunnel"];
// .stx/bundle-tmp/117f17f82e4a-29815-1.ts



var snapshot = state(tunnel.snapshot());
onMount(() => tunnel.subscribe((next) => snapshot.set(next)));
var locked = () => snapshot().phase !== "idle";
var choose = (id) => {
  if (locked())
    return;
  const region = REGIONS.find((entry) => entry.id === id);
  if (!region?.exitIp)
    return;
  haptics.selection();
  try {
    window.localStorage?.setItem("buddyvpn.region", id);
  } catch {}
  history.back();
};
return { "REGIONS": REGIONS, "choose": choose, "haptics": haptics, "locked": locked, "snapshot": snapshot, "tunnel": tunnel };
})();
REGIONS = __stxBundle_117f17f82e4a["REGIONS"];
choose = __stxBundle_117f17f82e4a["choose"];
haptics = __stxBundle_117f17f82e4a["haptics"];
locked = __stxBundle_117f17f82e4a["locked"];
snapshot = __stxBundle_117f17f82e4a["snapshot"];
tunnel = __stxBundle_117f17f82e4a["tunnel"];