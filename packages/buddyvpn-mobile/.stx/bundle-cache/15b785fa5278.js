var REGIONS = undefined;
var choose = undefined;
var haptics = undefined;
var locked = undefined;
var snapshot = undefined;
var tunnel = undefined;
var __stxBundle_15b785fa5278 = (function() {

// src/native.ts
var haptics = {
  selection() {
    try {
      window.craft?.haptics?.selection?.();
    } catch {}
  },
  impact(style = "medium") {
    try {
      window.craft?.haptics?.impact?.(style);
    } catch {}
  }
};

// src/regions.ts
var REGIONS = [
  { id: "us-west", badge: "US", country: "United States", city: "Hillsboro, Oregon · Pacific", exitIp: "5.78.208.190" },
  { id: "eu-central", badge: "DE", country: "Germany", city: "Falkenstein · Central European", exitIp: null }
];

// src/tunnel.ts
var FAKE_CONNECT_MS = 1400;
var FAKE_DISCONNECT_MS = 600;

class StubTunnel {
  current = {
    phase: "idle",
    region: null,
    uptimeSeconds: null,
    exitIp: null,
    error: null,
    simulated: true
  };
  listeners = new Set;
  connectedAt = null;
  clock = null;
  available() {
    return false;
  }
  snapshot() {
    return { ...this.current };
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(patch) {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners)
      listener(this.snapshot());
  }
  async connect(region) {
    if (this.current.phase !== "idle")
      return;
    const known = REGIONS.find((entry) => entry.id === region);
    if (!known) {
      this.emit({ error: "Unknown location" });
      return;
    }
    this.emit({ phase: "connecting", region, error: null });
    await new Promise((resolve) => setTimeout(resolve, FAKE_CONNECT_MS));
    this.connectedAt = Date.now();
    this.emit({ phase: "connected", exitIp: known.exitIp, uptimeSeconds: 0 });
    this.clock = setInterval(() => {
      if (this.connectedAt === null)
        return;
      this.emit({ uptimeSeconds: Math.floor((Date.now() - this.connectedAt) / 1000) });
    }, 1000);
  }
  async disconnect() {
    if (this.current.phase !== "connected")
      return;
    this.emit({ phase: "disconnecting" });
    await new Promise((resolve) => setTimeout(resolve, FAKE_DISCONNECT_MS));
    if (this.clock) {
      clearInterval(this.clock);
      this.clock = null;
    }
    this.connectedAt = null;
    this.emit({ phase: "idle", uptimeSeconds: null, exitIp: null });
  }
}
var tunnel = new StubTunnel;

// .stx/bundle-tmp/15b785fa5278-29815-3.ts
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
REGIONS = __stxBundle_15b785fa5278["REGIONS"];
choose = __stxBundle_15b785fa5278["choose"];
haptics = __stxBundle_15b785fa5278["haptics"];
locked = __stxBundle_15b785fa5278["locked"];
snapshot = __stxBundle_15b785fa5278["snapshot"];
tunnel = __stxBundle_15b785fa5278["tunnel"];