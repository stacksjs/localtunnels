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
var __stxBundle_4c11cdf20659 = (function() {

// src/native.ts
var BRIDGE_TIMEOUT_MS = 1500;
var resolved = null;
function whenNativeHost() {
  if (resolved)
    return resolved;
  resolved = new Promise((resolve) => {
    if (typeof window === "undefined")
      return resolve(false);
    if (window.craft)
      return resolve(true);
    const started = Date.now();
    const tick = () => {
      if (window.craft)
        return resolve(true);
      if (Date.now() - started > BRIDGE_TIMEOUT_MS)
        return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
  return resolved;
}
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
var DEFAULT_REGION = "us-west";
function regionById(id) {
  return REGIONS.find((region) => region.id === id) ?? null;
}

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
function formatUptime(seconds) {
  if (seconds === null || seconds < 0)
    return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const secs = seconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

// .stx/bundle-tmp/4c11cdf20659-33198-2.ts
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
DEFAULT_REGION = __stxBundle_4c11cdf20659["DEFAULT_REGION"];
busy = __stxBundle_4c11cdf20659["busy"];
connected = __stxBundle_4c11cdf20659["connected"];
deployed = __stxBundle_4c11cdf20659["deployed"];
formatUptime = __stxBundle_4c11cdf20659["formatUptime"];
haptics = __stxBundle_4c11cdf20659["haptics"];
here = __stxBundle_4c11cdf20659["here"];
native = __stxBundle_4c11cdf20659["native"];
phase = __stxBundle_4c11cdf20659["phase"];
region = __stxBundle_4c11cdf20659["region"];
regionById = __stxBundle_4c11cdf20659["regionById"];
snapshot = __stxBundle_4c11cdf20659["snapshot"];
statusLabel = __stxBundle_4c11cdf20659["statusLabel"];
stored = __stxBundle_4c11cdf20659["stored"];
toggle = __stxBundle_4c11cdf20659["toggle"];
tunnel = __stxBundle_4c11cdf20659["tunnel"];
whenNativeHost = __stxBundle_4c11cdf20659["whenNativeHost"];