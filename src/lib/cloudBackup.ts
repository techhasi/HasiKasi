import { db, getSettings } from '../db/db'
import { buildBackup, importBackupData } from './backup'
import { blobToDataURL } from './image'
import { todayISO } from './dates'
import { getActivePeriod } from './periods'

async function toBase64(text: string): Promise<string> {
  const dataUrl = await blobToDataURL(new Blob([text]))
  return dataUrl.split(',')[1]
}

/** Accept "owner/repo" or a pasted GitHub URL and return "owner/repo". */
export function normalizeRepo(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
}

async function uploadToGitHub(repo: string, token: string, path: string, jsonText: string): Promise<void> {
  const api = `https://api.github.com/repos/${repo}/contents/${path}`
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  // Updating an existing file requires its current blob SHA
  let sha: string | undefined
  const existing = await fetch(api, { headers })
  if (existing.ok) sha = (await existing.json()).sha

  const put = await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `HasiKasi backup ${path} (${new Date().toISOString()})`,
      content: await toBase64(jsonText),
      ...(sha ? { sha } : {})
    })
  })
  if (!put.ok) {
    const detail = await put.text().catch(() => '')
    throw new Error(`GitHub ${put.status}: ${detail.slice(0, 120)}`)
  }
}

async function creds(): Promise<{ repo: string; token: string; headers: Record<string, string> }> {
  const s = await getSettings()
  if (!s.backupRepo || !s.backupToken) throw new Error('Set the repo and token first')
  const token = s.backupToken.trim()
  return {
    repo: normalizeRepo(s.backupRepo),
    token,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }
}

export interface CloudBackupEntry {
  name: string
  path: string
  sizeKb: number
  label: string
}

/** List backup files available in the cloud repo, newest-relevant first. */
export async function listCloudBackups(): Promise<CloudBackupEntry[]> {
  const { repo, headers } = await creds()
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/`, { headers })
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  const items = (await res.json()) as { type: string; name: string; path: string; size: number }[]
  return items
    .filter(i => i.type === 'file' && /^hasikasi.*\.json$/i.test(i.name))
    .map(i => {
      const cycle = i.name.match(/^hasikasi-cycle-(\d{4}-\d{2}-\d{2})\.json$/i)
      return {
        name: i.name,
        path: i.path,
        sizeKb: Math.max(1, Math.round(i.size / 1024)),
        label: cycle ? `Cycle snapshot · ${cycle[1]}` : 'Latest daily backup'
      }
    })
    .sort((a, b) => (a.label.startsWith('Latest') ? -1 : b.label.startsWith('Latest') ? 1 : b.name.localeCompare(a.name)))
}

/** Download a cloud backup and restore it, replacing all local data. */
export async function restoreCloudBackup(path: string): Promise<void> {
  const { repo, token } = await creds()
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.raw+json', // raw content, avoids the 1MB base64 response limit
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  await importBackupData(JSON.parse(await res.text()))
}

/**
 * Cloud backup to the user's private GitHub repo:
 * - `hasikasi-latest.json` refreshed once per day on first app open
 * - `hasikasi-cycle-<startDate>.json` snapshot once per budget cycle
 * Returns a status message, or null when nothing needed doing.
 */
export async function autoBackup(force = false): Promise<string | null> {
  const s = await getSettings()
  if (!s.backupRepo || !s.backupToken) return force ? 'Set the repo and token first' : null
  const repo = normalizeRepo(s.backupRepo)
  const token = s.backupToken.trim()

  const today = todayISO()
  const active = await getActivePeriod()
  const needDaily = force || s.lastBackupDay !== today
  const needCycle = active != null && s.lastCycleBackup !== active.startDate
  if (!needDaily && !needCycle) return null

  const json = JSON.stringify(await buildBackup())
  const done: string[] = []
  if (needDaily) {
    await uploadToGitHub(repo, token, 'hasikasi-latest.json', json)
    await db.settings.update('app', { lastBackupDay: today })
    done.push('daily')
  }
  if (needCycle && active) {
    await uploadToGitHub(repo, token, `hasikasi-cycle-${active.startDate}.json`, json)
    await db.settings.update('app', { lastCycleBackup: active.startDate })
    done.push('cycle snapshot')
  }
  return `✅ Backed up (${done.join(' + ')})`
}
