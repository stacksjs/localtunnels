/* eslint-disable node/prefer-global/process */
import type { VpnKeyPair } from './types'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decodeKey, encodeKey, generateKeyPair, publicKeyFromPrivate } from './keys'

/** Directory holding this machine's VPN identity (`~/.localtunnels/vpn`). */
export function vpnDir(): string {
  const base = process.env.LOCALTUNNELS_HOME || join(homedir(), '.localtunnels')
  return join(base, 'vpn')
}

const PRIVATE_PATH = () => join(vpnDir(), 'privatekey')
const PUBLIC_PATH = () => join(vpnDir(), 'publickey')

export interface StoredIdentity {
  keyPair: VpnKeyPair
  privateKeyPath: string
  publicKeyPath: string
  created: boolean
}

/**
 * Load the machine's VPN identity, generating and persisting a new keypair on
 * first use. Private key is written with 0600 permissions.
 */
export function loadOrCreateIdentity(force = false): StoredIdentity {
  const dir = vpnDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const privPath = PRIVATE_PATH()
  const pubPath = PUBLIC_PATH()

  if (!force && existsSync(privPath)) {
    const privateKey = decodeKey(readFileSync(privPath, 'utf8').trim())
    const publicKey = publicKeyFromPrivate(privateKey)
    return { keyPair: { privateKey, publicKey }, privateKeyPath: privPath, publicKeyPath: pubPath, created: false }
  }

  const keyPair = generateKeyPair()
  writeFileSync(privPath, `${encodeKey(keyPair.privateKey)}\n`, { mode: 0o600 })
  chmodSync(privPath, 0o600)
  writeFileSync(pubPath, `${encodeKey(keyPair.publicKey)}\n`, { mode: 0o644 })
  return { keyPair, privateKeyPath: privPath, publicKeyPath: pubPath, created: true }
}
