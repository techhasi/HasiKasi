/**
 * Face ID app lock via WebAuthn platform authenticator.
 * Local privacy gate only — there is no server to verify assertions;
 * a user-verified credential assertion is treated as "unlocked".
 */

function toB64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

export function lockSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window
}

/** Register a platform (Face ID) credential; returns its id for storage. */
export async function enrollLock(): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'HasiKasi' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'hasikasi',
        displayName: 'HasiKasi'
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 } // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000
    }
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Face ID setup was cancelled')
  return toB64url(cred.rawId)
}

/** Prompt Face ID against the enrolled credential. */
export async function verifyLock(credentialId: string): Promise<boolean> {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId) as BufferSource }],
      userVerification: 'required',
      timeout: 60000
    }
  })
  return cred != null
}
