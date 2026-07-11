import { useEffect, useState } from 'react'
import { api, type Preference } from '../api'

// The learning loop, made visible. Every preference here silently shapes
// every future plan, so the user must be able to read and prune the list.
export default function MemoryView({ active }: { active: boolean }) {
  const [prefs, setPrefs] = useState<Preference[]>([])
  const [loaded, setLoaded] = useState(false)
  const [pendingId, setPendingId] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const res = await api.preferences()
      // Newest first: the most recently learned habit is the most interesting.
      setPrefs([...res.preferences].reverse())
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    if (active) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const forget = async (p: Preference) => {
    setError('')
    setPendingId(p.id)
    try {
      await api.deletePreference(p.id)
      setPrefs((ps) => ps.filter((x) => x.id !== p.id))
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
          <span className="kicker">memory &middot; {prefs.length}</span>
          <h2>What it has learned about how you work</h2>
          <p className="lede">
            Patterns from your evening debriefs, kept only when the evidence
            repeats. Every line here quietly shapes every future plan. If one
            is wrong, remove it; the planner stops using it immediately.
          </p>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!loaded && !error && (
        <p className="status-line" role="status">
          <span className="pulse" aria-hidden="true" />
          Reading the profile&hellip;
        </p>
      )}

      {loaded && prefs.length === 0 && !error && (
        <div className="empty">
          <span className="kicker">nothing learned yet</span>
          Submit evening debriefs and high-confidence patterns will start to
          appear here &mdash; things like when your focus is sharpest or what
          you consistently underestimate.
        </div>
      )}

      {prefs.length > 0 && (
        <div className="learned" style={{ borderLeft: 'none', paddingLeft: 0 }}>
          {prefs.map((p, i) => (
            <div className="memory-item" key={p.id} style={{ ['--i' as string]: i }}>
              <div className="memory-text">
                <span>{p.text}</span>
                <span className="memory-meta mono">
                  {p.learned_at ? `learned ${new Date(p.learned_at).toLocaleDateString()}` : ''}
                  {p.source ? ` · from: "${p.source}"` : ''}
                </span>
              </div>
              <button
                className="mini ghost"
                aria-label={`Forget: ${p.text}`}
                disabled={pendingId === p.id}
                onClick={() => forget(p)}
              >
                Forget
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
