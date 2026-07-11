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

export const api = {
  dump: (text: string) => req('POST', '/dump', { text }),
  tasks: (status?: string) =>
    req('GET', `/tasks${status ? `?status=${status}` : ''}`) as Promise<{ tasks: Task[] }>,
  updateTask: (id: string, fields: Partial<Task>) => req('PATCH', `/tasks/${id}`, fields),
  generateSitrep: () => req('POST', '/sitrep/generate'),
  latestSitrep: () => req('GET', '/sitrep/latest'),
  debrief: (answers: Record<string, string>) => req('POST', '/debrief', { answers }),
}
