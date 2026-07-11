import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

// Shape mirrors prompts/sitrep_prompt.py SCHEMA.
interface TimeBlock {
  start: string
  end: string
  label: string
  intent: string
}

interface Sitrep {
  date: string
  situation?: { overview: string; changes_since_yesterday?: string[] }
  mission?: { statement: string; why_decisive: string }
  execution?: {
    time_blocks?: TimeBlock[]
    priorities?: Record<string, { title: string; reason: string }[]>
    deliberately_dropped?: { title: string; reason: string }[]
  }
  sustainment?: { energy_plan: string; breaks?: string[] }
  command_signal?: {
    decision_points?: string[]
    blockers_to_escalate?: string[]
    say_no_to?: string[]
    overcommitment_warning?: string | null
  }
  debrief_questions?: string[]
}

const GENERATION_STAGES = [
  'Reading open tasks, learned preferences, and recent debriefs',
  'Weighing urgency against impact and picking one mission',
  'Laying out time blocks and deciding what to drop',
  'Writing the five sections',
]

function toMinutes(t: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((t ?? '').trim())
  if (!m) return null
  const v = parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
  return v >= 0 && v < 1440 ? v : null
}

function DayTimeline({ blocks }: { blocks: TimeBlock[] }) {
  const parsed = blocks
    .map((b) => ({ ...b, s: toMinutes(b.start), e: toMinutes(b.end) }))
    .filter((b): b is TimeBlock & { s: number; e: number } => b.s !== null && b.e !== null && b.e > b.s!)
  if (parsed.length === 0) return null

  const dayStart = Math.min(6 * 60, Math.floor(Math.min(...parsed.map((b) => b.s)) / 60) * 60)
  const dayEnd = Math.max(20 * 60, Math.ceil(Math.max(...parsed.map((b) => b.e)) / 60) * 60)
  const span = dayEnd - dayStart
  const hours = span / 60
  const scheduled = parsed.reduce((acc, b) => acc + (b.e - b.s), 0)
  const scheduledH = (scheduled / 60).toFixed(1)

  const hourLabels: { label: string; pct: number }[] = []
  const step = hours > 12 ? 4 : 2
  for (let m = dayStart; m <= dayEnd; m += step * 60) {
    hourLabels.push({
      label: `${String(Math.floor(m / 60)).padStart(2, '0')}:00`,
      pct: ((m - dayStart) / span) * 100,
    })
  }

  return (
    <div className="timeline" role="img" aria-label={`Day timeline: ${scheduledH} hours scheduled across ${parsed.length} blocks; the rest is reserve`}>
      <div className="tl-track" style={{ ['--hours' as string]: hours }}>
        {parsed.map((b, i) => (
          <div
            key={i}
            className="tl-block"
            style={{
              ['--i' as string]: i,
              left: `${((b.s - dayStart) / span) * 100}%`,
              width: `${((b.e - b.s) / span) * 100}%`,
            }}
            title={`${b.start}-${b.end} ${b.label}: ${b.intent}`}
          >
            <span>{b.label}</span>
          </div>
        ))}
      </div>
      <div className="tl-hours" aria-hidden="true">
        {hourLabels.map((h) => (
          <span key={h.label} style={{ left: `${h.pct}%` }}>
            {h.label}
          </span>
        ))}
      </div>
      <div className="tl-legend">
        <span>
          <i className="chip chip-block" /> scheduled &middot; {scheduledH}h in {parsed.length} blocks
        </span>
        <span>
          <i className="chip chip-reserve" /> reserve &middot; left open on purpose, because
          days never go to plan
        </span>
      </div>
    </div>
  )
}

function ParaHead({ num, title, plain }: { num: string; title: string; plain: string }) {
  return (
    <div className="para-head">
      <span className="para-num">{num}</span>
      <span className="para-title">{title}</span>
      <span className="para-plain">{plain}</span>
    </div>
  )
}

export default function SitrepView() {
  const [sitrep, setSitrep] = useState<Sitrep | null>(null)
  const [generatedAt, setGeneratedAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState(0)
  const [error, setError] = useState('')
  const stageTimer = useRef<number | undefined>(undefined)

  const load = async () => {
    try {
      const res = await api.latestSitrep()
      setSitrep(res.sitrep?.body ?? null)
      setGeneratedAt(res.sitrep?.created_at ?? '')
    } catch (e) {
      setError(String(e))
    }
  }

  const generate = async () => {
    setLoading(true)
    setError('')
    setStage(0)
    stageTimer.current = window.setInterval(
      () => setStage((s) => Math.min(s + 1, GENERATION_STAGES.length - 1)),
      7000,
    )
    try {
      const res = await api.generateSitrep()
      setSitrep(res.sitrep)
      setGeneratedAt(new Date().toISOString())
    } catch (e) {
      setError(String(e))
    } finally {
      window.clearInterval(stageTimer.current)
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    return () => window.clearInterval(stageTimer.current)
  }, [])

  const warn = sitrep?.command_signal?.overcommitment_warning
  const hasWarn = Boolean(warn && String(warn).trim().toLowerCase() !== 'null')
  const prios = sitrep?.execution?.priorities
  const prioMeta = {
    p1: { label: 'P1', plain: 'do these first' },
    p2: { label: 'P2', plain: 'then these' },
    p3: { label: 'P3', plain: 'if the day allows' },
  } as const

  return (
    <div>
      <div className="view-head">
        <div>
          <span className="kicker">today's game plan</span>
          <h2>{sitrep ? sitrep.date : 'No game plan yet'}</h2>
          {generatedAt && sitrep && (
            <p className="lede mono" style={{ fontSize: '0.7rem' }}>
              generated {new Date(generatedAt).toLocaleString()} &middot; amazon nova pro
            </p>
          )}
        </div>
        <button className="primary" onClick={generate} disabled={loading}>
          {loading ? 'Working' : sitrep ? 'Regenerate' : 'Generate game plan'}
        </button>
      </div>

      {loading && (
        <p className="status-line" role="status">
          <span className="pulse" aria-hidden="true" />
          {GENERATION_STAGES[stage]}&hellip;
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {!sitrep && !loading && (
        <div className="explainer rise">
          <span className="kicker">how this works</span>
          <p>
            <strong>1.</strong> Write everything on your mind into the Tasks tab.
            A fast model turns it into a scored task list.
          </p>
          <p>
            <strong>2.</strong> Generate your game plan, or wait for the scheduled
            one each morning. A reasoning model reads your tasks and history, then
            commits to one mission, a timed plan, and a list of deliberate drops.
          </p>
          <p>
            <strong>3.</strong> In the evening, answer three short questions in the
            Debrief tab. Patterns in your answers become preferences that shape
            every future game plan.
          </p>
        </div>
      )}

      {sitrep && (
        <>
          {sitrep.execution?.time_blocks && sitrep.execution.time_blocks.length > 0 && (
            <DayTimeline blocks={sitrep.execution.time_blocks} />
          )}

          <section className="para rise" style={{ ['--i' as string]: 1 }}>
            <ParaHead num="1" title="Situation" plain="where things stand" />
            <p>{sitrep.situation?.overview}</p>
            {!!sitrep.situation?.changes_since_yesterday?.length && (
              <ul>
                {sitrep.situation.changes_since_yesterday.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="para rise" style={{ ['--i' as string]: 2 }}>
            <ParaHead num="2" title="Mission" plain="the one thing that matters most today" />
            <p className="mission-statement">{sitrep.mission?.statement}</p>
            <p className="mission-why">{sitrep.mission?.why_decisive}</p>
          </section>

          <section className="para rise" style={{ ['--i' as string]: 3 }}>
            <ParaHead num="3" title="Execution" plain="the plan: time blocks, priorities, deliberate cuts" />
            <div className="blocks">
              {sitrep.execution?.time_blocks?.map((b, i) => (
                <div className="block" key={i}>
                  <span className="when">
                    {b.start}&ndash;{b.end}
                  </span>
                  <span className="what">{b.label}</span>
                  <span className="intent">{b.intent}</span>
                </div>
              ))}
            </div>
            {(['p1', 'p2', 'p3'] as const).map(
              (p) =>
                !!prios?.[p]?.length && (
                  <div key={p} className="prio-group">
                    <span className={`tag ${p}`}>
                      {prioMeta[p].label} &middot; {prioMeta[p].plain}
                    </span>
                    <div className="prio-items">
                      {prios[p].map((t, i) => (
                        <span key={i}>
                          {t.title} <span className="reason">{t.reason}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ),
            )}
            {!!sitrep.execution?.deliberately_dropped?.length && (
              <div className="prio-group">
                <span className="tag drop">dropped on purpose</span>
                <div className="prio-items">
                  {sitrep.execution.deliberately_dropped.map((d, i) => (
                    <span key={i}>
                      <span className="dropped-title">{d.title}</span>{' '}
                      <span className="reason">{d.reason}</span>
                    </span>
                  ))}
                  <span className="group-plain">
                    cut so that today stays achievable; they return to the pool tomorrow
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="para rise" style={{ ['--i' as string]: 4 }}>
            <ParaHead num="4" title="Sustainment" plain="pacing: energy and breaks" />
            <p>{sitrep.sustainment?.energy_plan}</p>
            {!!sitrep.sustainment?.breaks?.length && (
              <ul>
                {sitrep.sustainment.breaks.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="para rise" style={{ ['--i' as string]: 5 }}>
            <ParaHead
              num="5"
              title="Command &amp; Signal"
              plain="decisions to watch for, blockers to raise, requests to decline"
            />
            {sitrep.command_signal?.decision_points?.map((d, i) => (
              <div className="signal-row" key={`dp${i}`}>
                <span className="tag p3">decision</span>
                <span>{d}</span>
              </div>
            ))}
            {sitrep.command_signal?.blockers_to_escalate?.map((b, i) => (
              <div className="signal-row" key={`bl${i}`}>
                <span className="tag warn">blocker</span>
                <span>{b}</span>
              </div>
            ))}
            {sitrep.command_signal?.say_no_to?.map((s, i) => (
              <div className="signal-row" key={`no${i}`}>
                <span className="tag drop">decline</span>
                <span>{s}</span>
              </div>
            ))}
            {hasWarn && (
              <div className="warn-banner">
                <span className="kicker">overcommitment warning</span>
                {warn}
              </div>
            )}
          </section>

          {!!sitrep.debrief_questions?.length && (
            <section className="para rise" style={{ ['--i' as string]: 6 }}>
              <ParaHead num="+" title="This evening" plain="three questions waiting in the Debrief tab" />
              <ul>
                {sitrep.debrief_questions.map((q, i) => (
                  <li key={i} className="dim">
                    {q}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
