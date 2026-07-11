import { useEffect, useRef, useState } from 'react'
import { api, Task } from '../api'

function Meter({ value, hot }: { value?: number; hot?: boolean }) {
  if (!value) return <span className="faint mono">&mdash;</span>
  const v = Math.max(0, Math.min(5, Math.round(value)))
  return (
    <span
      className={`meter${hot && v >= 4 ? ' hot' : ''}`}
      role="img"
      aria-label={`${v} out of 5`}
      title={`${v} / 5`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= v ? 'on' : ''} style={{ ['--d' as string]: i }} />
      ))}
    </span>
  )
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} aria-hidden="true">
          <td colSpan={7}>
            <div className="skel" style={{ ['--i' as string]: i }} />
          </td>
        </tr>
      ))}
    </>
  )
}

type Filter = 'open' | 'done' | 'dropped'

interface EditDraft {
  title: string
  project: string
  urgency: number
  impact: number
  effort_hours: string
  due: string
}

export default function TasksView({ active }: { active: boolean }) {
  const [dump, setDump] = useState('')
  const [quickTitle, setQuickTitle] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<Filter>('open')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState('')
  const [editingId, setEditingId] = useState('')
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const [arrived, setArrived] = useState<Set<string>>(new Set())
  const [undo, setUndo] = useState<{ id: string; title: string; status: string } | null>(null)
  const exitTimers = useRef<number[]>([])
  const undoTimer = useRef<number | undefined>(undefined)

  const load = async (f: Filter = filter) => {
    setError('')
    try {
      const res = await api.tasks(f)
      setTasks(res.tasks)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setLoaded(true)
    }
  }

  // Views stay mounted across tab switches; refetch on activation so tasks
  // closed elsewhere (debrief task_updates, another device) don't linger.
  useEffect(() => {
    if (active && !busy && leaving.size === 0) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    const timers = exitTimers.current
    return () => {
      timers.forEach(clearTimeout)
      window.clearTimeout(undoTimer.current)
    }
  }, [])

  const switchFilter = (f: Filter) => {
    setFilter(f)
    setLoaded(false)
    setEditingId('')
    load(f)
  }

  const submitDump = async () => {
    if (!dump.trim() || busy) return
    setBusy(true)
    setError('')
    const before = new Set(tasks.map((t) => t.id))
    try {
      await api.dump(dump.trim())
      setDump('')
      if (filter !== 'open') setFilter('open')
      const res = await api.tasks('open')
      setTasks(res.tasks)
      const fresh = new Set(res.tasks.filter((t) => !before.has(t.id)).map((t) => t.id))
      setArrived(fresh)
      exitTimers.current.push(window.setTimeout(() => setArrived(new Set()), 1800))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const quickAdd = async () => {
    const title = quickTitle.trim()
    if (!title || adding) return
    setAdding(true)
    setError('')
    try {
      const res = await api.createTask({ title })
      setQuickTitle('')
      if (filter === 'open') {
        setTasks((ts) => [res.task, ...ts])
        setArrived(new Set([res.task.id]))
        exitTimers.current.push(window.setTimeout(() => setArrived(new Set()), 1800))
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setAdding(false)
    }
  }

  const showUndo = (id: string, title: string, status: string) => {
    setUndo({ id, title, status })
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndo(null), 7000)
  }

  const mark = async (id: string, status: 'done' | 'dropped') => {
    setError('')
    setPendingId(id)
    const title = tasks.find((t) => t.id === id)?.title ?? ''
    try {
      await api.updateTask(id, { status })
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) {
        setTasks((ts) => ts.filter((t) => t.id !== id))
      } else {
        setLeaving((s) => new Set(s).add(id))
        exitTimers.current.push(
          window.setTimeout(() => {
            setTasks((ts) => ts.filter((t) => t.id !== id))
            setLeaving((s) => {
              const n = new Set(s)
              n.delete(id)
              return n
            })
          }, 260),
        )
      }
      showUndo(id, title, status)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setPendingId('')
    }
  }

  const reopen = async (id: string) => {
    setError('')
    setPendingId(id)
    try {
      await api.updateTask(id, { status: 'open' })
      setUndo(null)
      await load()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setPendingId('')
    }
  }

  const startEdit = (t: Task) => {
    setEditingId(t.id)
    setDraft({
      title: t.title,
      project: t.project ?? '',
      urgency: t.triage?.urgency ?? 3,
      impact: t.triage?.impact ?? 3,
      effort_hours: String(t.triage?.effort_hours ?? 1),
      due: t.due ?? '',
    })
  }

  const saveEdit = async (t: Task) => {
    if (!draft) return
    setError('')
    setPendingId(t.id)
    const fields: Partial<Task> = {
      title: draft.title.trim() || t.title,
      project: draft.project.trim() || null,
      due: draft.due.trim() || null,
      triage: {
        urgency: draft.urgency,
        impact: draft.impact,
        effort_hours: Math.max(0.25, Math.min(8, parseFloat(draft.effort_hours) || 1)),
        rationale: t.triage?.rationale ?? '',
      },
    }
    try {
      await api.updateTask(t.id, fields)
      setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...fields } as Task : x)))
      setEditingId('')
      setDraft(null)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setPendingId('')
    }
  }

  const filterMeta: Record<Filter, string> = {
    open: 'The pool the planner draws from',
    done: 'Finished work, kept on the record',
    dropped: 'Set aside; reopen anything that still matters',
  }

  return (
    <div>
      <div className="view-head">
        <div>
          <span className="kicker">capture</span>
          <h2>Write it all down</h2>
          <p className="lede">
            Half-formed is fine. A fast model splits whatever you write into
            separate tasks and scores each one for urgency, impact, and honest
            effort, so nothing needs to be structured up front.
          </p>
        </div>
      </div>
      <textarea
        rows={5}
        value={dump}
        id="brain-dump"
        name="brain-dump"
        aria-label="Brain dump"
        placeholder="e.g. finish the cost memo by friday, follow up with the pilot program, onboarding email still broken, book flights for the conference sometime..."
        onChange={(e) => setDump(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitDump()
        }}
      />
      <div className="row">
        <button className="primary" onClick={submitDump} disabled={busy}>
          {busy ? 'Sorting' : 'Sort into tasks'}
        </button>
        <span className="hint">Cmd+Enter works too</span>
      </div>
      {busy && (
        <p className="status-line" role="status">
          <span className="pulse" aria-hidden="true" />
          Splitting your notes into scored tasks&hellip;
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="view-head" style={{ marginTop: '2.6rem' }}>
        <div>
          <span className="kicker">tasks &middot; {tasks.length}</span>
          <h2>{filterMeta[filter]}</h2>
        </div>
        <div className="seg" role="tablist" aria-label="Task status filter">
          {(['open', 'done', 'dropped'] as const).map((f) => (
            <button
              key={f}
              className="mini ghost"
              aria-current={filter === f ? 'true' : undefined}
              onClick={() => switchFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filter === 'open' && (
        <div className="quick-add">
          <input
            value={quickTitle}
            id="quick-add-task"
            name="quick-add-task"
            aria-label="Add one task directly"
            placeholder="Add one task directly, no sorting - e.g. renew the domain"
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && quickAdd()}
          />
          <button className="ghost" onClick={quickAdd} disabled={adding || !quickTitle.trim()}>
            {adding ? 'Adding' : 'Add'}
          </button>
        </div>
      )}

      {undo && (
        <div className="undo-toast" role="status">
          <span>
            Marked {undo.status}: <strong>{undo.title}</strong>
          </span>
          <button className="mini ghost" onClick={() => reopen(undo.id)}>
            Undo
          </button>
        </div>
      )}

      {loaded && error && tasks.length === 0 ? (
        <div className="empty">
          <span className="kicker">could not load tasks</span>
          <button className="ghost" onClick={() => load()} style={{ marginTop: '0.6rem' }}>
            Try again
          </button>
        </div>
      ) : loaded && tasks.length === 0 ? (
        <div className="empty">
          <span className="kicker">nothing here yet</span>
          {filter === 'open' ? (
            <>
              Everything you write above becomes a scored task in this list, and
              tomorrow&rsquo;s game plan is built from it.
            </>
          ) : (
            <>Nothing {filter} yet.</>
          )}
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Project</th>
                <th title="Time pressure, 1 to 5">Urgency</th>
                <th title="Consequence of doing it, 1 to 5">Impact</th>
                <th title="Honest effort estimate, in hours">Est. hours</th>
                <th>Due</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <SkeletonRows />
              ) : (
                tasks.map((t) =>
                  editingId === t.id && draft ? (
                    <tr key={t.id} className="row-editing">
                      <td>
                        <input
                          className="cell-input"
                          value={draft.title}
                          aria-label="Task title"
                          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="cell-input"
                          value={draft.project}
                          aria-label="Project"
                          placeholder="none"
                          onChange={(e) => setDraft({ ...draft, project: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="cell-input"
                          value={draft.urgency}
                          aria-label="Urgency, 1 to 5"
                          onChange={(e) => setDraft({ ...draft, urgency: Number(e.target.value) })}
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="cell-input"
                          value={draft.impact}
                          aria-label="Impact, 1 to 5"
                          onChange={(e) => setDraft({ ...draft, impact: Number(e.target.value) })}
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="cell-input"
                          value={draft.effort_hours}
                          aria-label="Estimated hours"
                          inputMode="decimal"
                          onChange={(e) => setDraft({ ...draft, effort_hours: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="cell-input"
                          value={draft.due}
                          aria-label="Due date"
                          placeholder="YYYY-MM-DD"
                          onChange={(e) => setDraft({ ...draft, due: e.target.value })}
                        />
                      </td>
                      <td className="actions">
                        <button
                          className="mini primary"
                          disabled={pendingId === t.id}
                          onClick={() => saveEdit(t)}
                        >
                          save
                        </button>
                        <button
                          className="mini ghost"
                          onClick={() => {
                            setEditingId('')
                            setDraft(null)
                          }}
                        >
                          cancel
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={t.id}
                      className={
                        leaving.has(t.id) ? 'row-leaving' : arrived.has(t.id) ? 'row-new' : undefined
                      }
                    >
                      <td>
                        {t.title}
                        {t.triage?.rationale && <span className="notes">{t.triage.rationale}</span>}
                      </td>
                      <td className="dim">{t.project ?? <span className="faint">&mdash;</span>}</td>
                      <td>
                        <Meter value={t.triage?.urgency} hot />
                      </td>
                      <td>
                        <Meter value={t.triage?.impact} />
                      </td>
                      <td className="mono">
                        {t.triage?.effort_hours ?? <span className="faint">&mdash;</span>}
                      </td>
                      <td className="mono">{t.due ?? <span className="faint">&mdash;</span>}</td>
                      <td className="actions">
                        {filter === 'open' ? (
                          <>
                            <button
                              className="mini primary"
                              aria-label={`Mark ${t.title} done`}
                              disabled={pendingId === t.id}
                              onClick={() => mark(t.id, 'done')}
                            >
                              done
                            </button>
                            <button
                              className="mini ghost"
                              aria-label={`Edit ${t.title}`}
                              disabled={pendingId === t.id}
                              onClick={() => startEdit(t)}
                            >
                              edit
                            </button>
                            <button
                              className="mini ghost"
                              aria-label={`Drop ${t.title}`}
                              disabled={pendingId === t.id}
                              onClick={() => mark(t.id, 'dropped')}
                            >
                              drop
                            </button>
                          </>
                        ) : (
                          <button
                            className="mini ghost"
                            aria-label={`Reopen ${t.title}`}
                            disabled={pendingId === t.id}
                            onClick={() => reopen(t.id)}
                          >
                            reopen
                          </button>
                        )}
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
