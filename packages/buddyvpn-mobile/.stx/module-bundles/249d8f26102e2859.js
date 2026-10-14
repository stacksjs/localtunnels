;(function() {
  var __stxBundles = globalThis.__stxModuleBundles || (globalThis.__stxModuleBundles = {});
  if (__stxBundles["241f7c87a1bd"]) return;
  __stxBundles["241f7c87a1bd"] = true;

var __stxRegistered0 = undefined;
var __stxRegistered1 = undefined;
var __stxRegistered2 = undefined;
var __stxBundle_b3ebc63ec660 = (function() {

var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/native.ts
var exports_native = {};
__export(exports_native, {
  haptics: () => haptics,
  isNativeHost: () => isNativeHost,
  whenNativeHost: () => whenNativeHost
});
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
function isNativeHost() {
  return typeof window !== "undefined" && Boolean(window.craft);
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
var exports_regions = {};
__export(exports_regions, {
  DEFAULT_REGION: () => DEFAULT_REGION,
  REGIONS: () => REGIONS,
  isDeployed: () => isDeployed,
  regionById: () => regionById
});
var REGIONS = [
  { id: "us-west", badge: "US", country: "United States", city: "Hillsboro, Oregon · Pacific", exitIp: "5.78.208.190" },
  { id: "eu-central", badge: "DE", country: "Germany", city: "Falkenstein · Central European", exitIp: null }
];
var DEFAULT_REGION = "us-west";
function regionById(id) {
  return REGIONS.find((region) => region.id === id) ?? null;
}
function isDeployed(region) {
  return region.exitIp !== null;
}

// src/tunnel.ts
var exports_tunnel = {};
__export(exports_tunnel, {
  StubTunnel: () => StubTunnel,
  formatUptime: () => formatUptime,
  tunnel: () => tunnel
});
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

// .stx/bundle-tmp/b3ebc63ec660-29815-2.ts
globalThis.__stxModules = globalThis.__stxModules || {};
if (!globalThis.__stxModules["src/native.ts"])
  globalThis.__stxModules["src/native.ts"] = exports_native;
if (!globalThis.__stxModules["src/regions.ts"])
  globalThis.__stxModules["src/regions.ts"] = exports_regions;
if (!globalThis.__stxModules["src/tunnel.ts"])
  globalThis.__stxModules["src/tunnel.ts"] = exports_tunnel;
return { "__stxRegistered0": exports_native, "__stxRegistered1": exports_regions, "__stxRegistered2": exports_tunnel };
})();
__stxRegistered0 = __stxBundle_b3ebc63ec660["__stxRegistered0"];
__stxRegistered1 = __stxBundle_b3ebc63ec660["__stxRegistered1"];
__stxRegistered2 = __stxBundle_b3ebc63ec660["__stxRegistered2"];
})();