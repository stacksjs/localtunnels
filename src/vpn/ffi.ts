/* eslint-disable node/prefer-global/process */
import type { Pointer } from 'bun:ffi'
import { dlopen, FFIType, suffix } from 'bun:ffi'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Raised when the native `libltvpn` shared library cannot be located or
 * loaded. VPN features are unavailable, but the rest of localtunnels (the
 * HTTP tunnel) continues to work — callers should catch this and degrade
 * gracefully.
 */
export class VpnUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'VpnUnavailableError'
  }
}

/** ABI version this TypeScript layer expects from the native library. */
export const EXPECTED_ABI_VERSION = 1

const LIB_BASENAME = `libltvpn.${suffix}`

/**
 * Candidate locations for the shared library, most specific first:
 *   1. `LTVPN_LIB` env override (absolute path to the library file)
 *   2. `dist/native/` — where the published npm package ships prebuilt libs
 *   3. `native/zig-out/lib/` — where `zig build` puts it during development
 */
function candidatePaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url))
  const paths: string[] = []

  const override = process.env.LTVPN_LIB
  if (override)
    paths.push(override)

  // src/vpn -> ../../ is the package root in dev; in dist it is dist/src/vpn.
  const pkgRootDev = join(here, '..', '..')
  paths.push(join(pkgRootDev, 'dist', 'native', LIB_BASENAME))
  paths.push(join(pkgRootDev, 'native', 'zig-out', 'lib', LIB_BASENAME))
  // When running from dist/src/vpn, the package root is one level higher.
  const pkgRootDist = join(here, '..', '..', '..')
  paths.push(join(pkgRootDist, 'dist', 'native', LIB_BASENAME))
  paths.push(join(pkgRootDist, 'native', 'zig-out', 'lib', LIB_BASENAME))

  return paths
}

const symbols = {
  ltvpn_version: { args: [], returns: FFIType.u32 },
  ltvpn_keypair: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  ltvpn_pubkey: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  ltvpn_hs_new: {
    args: [FFIType.u8, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.ptr,
  },
  ltvpn_hs_free: { args: [FFIType.ptr], returns: FFIType.void },
  ltvpn_hs_create_initiation: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  ltvpn_hs_consume_initiation: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  ltvpn_hs_create_response: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  ltvpn_hs_consume_response: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  ltvpn_hs_peer_index: { args: [FFIType.ptr], returns: FFIType.u32 },
  ltvpn_session_from_handshake: { args: [FFIType.ptr], returns: FFIType.ptr },
  ltvpn_session_new: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.ptr,
  },
  ltvpn_session_free: { args: [FFIType.ptr], returns: FFIType.void },
  ltvpn_encrypted_len: { args: [FFIType.u64], returns: FFIType.u64 },
  ltvpn_session_encrypt: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64],
    returns: FFIType.i64,
  },
  ltvpn_session_decrypt: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64],
    returns: FFIType.i64,
  },
} as const

/** Argument accepted by the native library wherever it expects a pointer. */
type PtrArg = Uint8Array | Pointer | null

/**
 * Typed view over the native `libltvpn` C ABI. Written out explicitly (rather
 * than derived from the `symbols` literal) so declaration emit works under
 * `isolatedDeclarations`.
 */
export interface LtvpnSymbols {
  ltvpn_version: () => number
  ltvpn_keypair: (priv: PtrArg, pub: PtrArg) => number
  ltvpn_pubkey: (priv: PtrArg, pub: PtrArg) => number
  ltvpn_hs_new: (isInitiator: number, staticPriv: PtrArg, peerPub: PtrArg, psk: PtrArg) => Pointer | null
  ltvpn_hs_free: (hs: PtrArg) => void
  ltvpn_hs_create_initiation: (hs: PtrArg, senderIndex: number, unixSec: bigint, nano: number, out: PtrArg) => number
  ltvpn_hs_consume_initiation: (hs: PtrArg, msg: PtrArg, outPeerPub: PtrArg, outPeerIndex: PtrArg, outTimestamp: PtrArg) => number
  ltvpn_hs_create_response: (hs: PtrArg, senderIndex: number, out: PtrArg) => number
  ltvpn_hs_consume_response: (hs: PtrArg, msg: PtrArg) => number
  ltvpn_hs_peer_index: (hs: PtrArg) => number
  ltvpn_session_from_handshake: (hs: PtrArg) => Pointer | null
  ltvpn_session_new: (sendKey: PtrArg, recvKey: PtrArg, localIndex: number, peerIndex: number) => Pointer | null
  ltvpn_session_free: (s: PtrArg) => void
  ltvpn_encrypted_len: (plainLen: bigint) => bigint
  ltvpn_session_encrypt: (s: PtrArg, plaintext: PtrArg, plainLen: bigint, out: PtrArg, outCap: bigint) => bigint
  ltvpn_session_decrypt: (s: PtrArg, msg: PtrArg, msgLen: bigint, out: PtrArg, outCap: bigint) => bigint
}

let cached: LtvpnSymbols | null = null

/**
 * Load (and memoize) the native library. Throws {@link VpnUnavailableError}
 * if it cannot be found or has an incompatible ABI version.
 */
export function loadNative(): LtvpnSymbols {
  if (cached)
    return cached

  const tried = candidatePaths()
  const found = tried.find(p => existsSync(p))
  if (!found) {
    throw new VpnUnavailableError(
      `native libltvpn not found. Build it with \`cd native && zig build\`, or set LTVPN_LIB. Looked in:\n  ${tried.join('\n  ')}`,
    )
  }

  let lib: ReturnType<typeof dlopen<typeof symbols>>
  try {
    lib = dlopen(found, symbols)
  }
  catch (err) {
    throw new VpnUnavailableError(`failed to load ${found}`, { cause: err })
  }

  const version = lib.symbols.ltvpn_version()
  if (version !== EXPECTED_ABI_VERSION) {
    throw new VpnUnavailableError(
      `libltvpn ABI mismatch: native reports v${version}, expected v${EXPECTED_ABI_VERSION}. Rebuild the native library.`,
    )
  }

  cached = lib.symbols as unknown as LtvpnSymbols
  return cached
}

/** Whether the native library is present and loadable. Never throws. */
export function isVpnAvailable(): boolean {
  try {
    loadNative()
    return true
  }
  catch {
    return false
  }
}

/** Error code → human-readable name, mirroring the LtvpnError enum in lib.zig. */
export const ERROR_NAMES: Record<number, string> = {
  0: 'ok',
  [-1]: 'wrong_state',
  [-2]: 'invalid_message',
  [-3]: 'invalid_mac',
  [-4]: 'decrypt_failed',
  [-5]: 'weak_key',
  [-6]: 'buffer_too_small',
  [-7]: 'payload_too_large',
  [-8]: 'wrong_receiver',
  [-9]: 'replay',
  [-10]: 'counter_exhausted',
  [-11]: 'out_of_memory',
  [-12]: 'entropy_unavailable',
}

export function errorName(code: number): string {
  return ERROR_NAMES[code] ?? `unknown(${code})`
}
