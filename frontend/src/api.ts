// Thin API client. Base URL comes from VITE_API_URL at build time;
// the shared key is entered once in the UI and kept in localStorage.

const BASE = import.meta.env.VITE_API_URL as string

export function getKey(): string {
  return localStorage.getItem('sitrep-key') ?? ''
}
export function setKey(k: string) {
  localStorage.setItem('sitrep-key', k)
}

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-sitrep-key': getKey(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401) {
    // The stored key is no longer valid (e.g. rotated on redeploy):
    // drop it and let the app fall back to the gate instead of scattering
    // raw 401 strings across every view.
    setKey('')
    window.dispatchEvent(new Event('sitrep-unauthorized'))
    throw new Error('Access key not accepted. Enter it again.')
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json()
}

export interface Task {
  id: string
  title: string
  notes?: string
  project?: string | null
  status: 'open' | 'done' | 'dropped'
  due?: string | null
  triage?: { urgency: number; impact: number; effort_hours: number; rationale: string }
}

export interface Preference {
  id: string
  text: string
  source?: string
  confidence?: string
  learned_at?: string
}

export type BlockStatus = Record<string, 'done' | 'skipped'>

export interface AppliedTaskUpdate {
  task_id: string
  status: 'done' | 'dropped'
  title: string
}

export const api = {
  dump: (text: string) => req('POST', '/dump', { text }),
  tasks: (status?: string) =>
    req('GET', `/tasks${status ? `?status=${status}` : ''}`) as Promise<{ tasks: Task[] }>,
  createTask: (fields: { title: string } & Partial<Task>) =>
    req('POST', '/tasks', fields) as Promise<{ task: Task }>,
  updateTask: (id: string, fields: Partial<Task>) => req('PATCH', `/tasks/${id}`, fields),
  generateSitrep: () => req('POST', '/sitrep/generate'),
  replanSitrep: (note: string) => req('POST', '/sitrep/replan', { note }),
  latestSitrep: () => req('GET', '/sitrep/latest'),
  setBlockStatus: (date: string, index: number, status: 'done' | 'skipped' | null) =>
    req('PATCH', `/sitrep/${date}/blocks`, { index, status }) as Promise<{ block_status: BlockStatus }>,
  preferences: () => req('GET', '/preferences') as Promise<{ preferences: Preference[] }>,
  deletePreference: (id: string) => req('DELETE', `/preferences/${id}`),
  debrief: (answers: Record<string, string>) =>
    req('POST', '/debrief', { answers }) as Promise<{
      analysis: Record<string, unknown>
      applied_task_updates: AppliedTaskUpdate[]
    }>,
}
