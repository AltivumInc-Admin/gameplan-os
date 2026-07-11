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

export default function TasksView({ active }: { active: boolean }) {
  const [dump, setDump] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState('')
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const [arrived, setArrived] = useState<Set<string>>(new Set())
  const exitTimers = useRef<number[]>([])

  const load = async () => {
    setError('')
    try {
      const res = await api.tasks('open')
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
    return () => timers.forEach(clearTimeout)
  }, [])

  const submitDump = async () => {
    if (!dump.trim() || busy) return
    setBusy(true)
    setError('')
    const before = new Set(tasks.map((t) => t.id))
    try {
      await api.dump(dump.trim())
      setDump('')
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

  const mark = async (id: string, status: 'done' | 'dropped') => {
    setError('')
    setPendingId(id)
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
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setPendingId('')
    }
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
          <span className="kicker">open tasks &middot; {tasks.length}</span>
          <h2>The pool the planner draws from</h2>
        </div>
      </div>

      {loaded && error && tasks.length === 0 ? (
        <div className="empty">
          <span className="kicker">could not load tasks</span>
          <button className="ghost" onClick={load} style={{ marginTop: '0.6rem' }}>
            Try again
          </button>
        </div>
      ) : loaded && tasks.length === 0 ? (
        <div className="empty">
          <span className="kicker">nothing here yet</span>
          Everything you write above becomes a scored task in this list, and
          tomorrow&rsquo;s game plan is built from it.
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
                tasks.map((t) => (
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
                        aria-label={`Drop ${t.title}`}
                        disabled={pendingId === t.id}
                        onClick={() => mark(t.id, 'dropped')}
                      >
                        drop
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
