// Thin API client. Base URL comes from VITE_API_URL at build time.
// Auth: a Cognito session (Authorization bearer) is preferred; the legacy
// service key in localStorage still works for pre-Cognito sessions.

import { accessToken, clearSession, getSession, refreshSession } from './auth'

const BASE = import.meta.env.VITE_API_URL as string

export function getKey(): string {
  return localStorage.getItem('sitrep-key') ?? ''
}
export function setKey(k: string) {
  localStorage.setItem('sitrep-key', k)
}

export function hasCredentials(): boolean {
  return Boolean(getSession() || getKey())
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = await accessToken()
  if (token) headers.authorization = `Bearer ${token}`
  else if (getKey()) headers['x-sitrep-key'] = getKey()
  return headers
}

async function req(method: string, path: string, body?: unknown, retried = false) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: await authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401) {
    // One silent refresh-and-retry for an expired session; after that the
    // credentials are dead (signed out elsewhere, rotated key): clear them
    // and fall back to the front door instead of scattering raw 401s.
    if (!retried && getSession() && (await refreshSession())) {
      return req(method, path, body, true)
    }
    clearSession()
    setKey('')
    window.dispatchEvent(new Event('sitrep-unauthorized'))
    throw new Error('Your session ended. Sign in again.')
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

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  at?: string
}

export interface AgentTurn {
  reply: string
  tools_used: string[]
  mutated: boolean
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
  agentHistory: () => req('GET', '/agent/chat') as Promise<{ messages: ChatMessage[] }>,
  agentChat: (message: string) =>
    req('POST', '/agent/chat', { message }) as Promise<AgentTurn>,
  agentReset: () => req('POST', '/agent/chat', { reset: true }),
}
