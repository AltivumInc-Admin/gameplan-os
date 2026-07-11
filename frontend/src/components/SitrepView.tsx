import { useEffect, useRef, useState } from 'react'
import { api, type BlockStatus } from '../api'

// Shape mirrors prompts/sitrep_prompt.py SCHEMA.
interface TimeBlock {
  start: string
  end: string
  label: string
  intent: string
  task_ids?: (string | null)[]
}

interface PlanItem {
  task_id?: string | null
  title: string
  reason: string
}

export interface Sitrep {
  date: string
  situation?: { overview: string; changes_since_yesterday?: string[] }
  mission?: { statement: string; why_decisive: string }
  execution?: {
    time_blocks?: TimeBlock[]
    priorities?: Record<string, PlanItem[]>
    deliberately_dropped?: PlanItem[]
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

const REPLAN_STAGES = [
  'Reading your report and how the day has gone so far',
  'Keeping the mission and everything already behind you',
  'Rebuilding the rest of the day around what changed',
  'Writing the revision',
]

function toMinutes(t: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((t ?? '').trim())
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface ParsedBlock extends TimeBlock {
  s: number
  e: number
  /** Index into the RAW time_blocks array, which keys hotIdx and blockRefs. */
  idx: number
}

export function DayTimeline({
  blocks,
  blockStatus,
  isToday,
  busy,
  hotIdx,
  onHot,
  onJump,
}: {
  blocks: TimeBlock[]
  blockStatus: BlockStatus
  isToday: boolean
  busy: boolean
  hotIdx: number | null
  onHot: (i: number | null) => void
  onJump: (i: number) => void
}) {
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes())
  useEffect(() => {
    const t = setInterval(
      () => setNowMin(new Date().getHours() * 60 + new Date().getMinutes()),
      30_000,
    )
    return () => clearInterval(t)
  }, [])

  const parsed: ParsedBlock[] = blocks
    .map((b, idx) => ({ ...b, idx, s: toMinutes(b.start), e: toMinutes(b.end) }))
    .filter((b): b is ParsedBlock => b.s !== null && b.e !== null && b.e > b.s)
    .sort((a, b) => a.s - b.s)
  if (parsed.length === 0) return null

  const dayStart = Math.min(6 * 60, Math.floor(Math.min(...parsed.map((b) => b.s)) / 60) * 60)
  const dayEnd = Math.max(20 * 60, Math.ceil(Math.max(...parsed.map((b) => b.e)) / 60) * 60)
  const span = dayEnd - dayStart
  const hours = span / 60

  // Scheduled time is the union of the (possibly overlapping) blocks.
  let scheduled = 0
  let coveredTo = -1
  for (const b of parsed) {
    const from = Math.max(b.s, coveredTo)
    if (b.e > from) {
      scheduled += b.e - from
      coveredTo = b.e
    }
  }
  const scheduledH = (scheduled / 60).toFixed(1)

  // Span is clamped to >= 14h, so 4h ticks are always the right density.
  const hourLabels: { label: string; pct: number }[] = []
  for (let m = dayStart; m < dayEnd; m += 4 * 60) {
    hourLabels.push({
      label: `${String(Math.floor(m / 60)).padStart(2, '0')}:00`,
      pct: ((m - dayStart) / span) * 100,
    })
  }
  hourLabels.push({
    label: `${String(Math.floor(dayEnd / 60)).padStart(2, '0')}:00`,
    pct: 100,
  })

  const nowPct = isToday && nowMin >= dayStart && nowMin <= dayEnd
    ? ((nowMin - dayStart) / span) * 100
    : null

  const doneCount = parsed.filter((b) => blockStatus[String(b.idx)] === 'done').length

  return (
    <div
      className="timeline"
      role="img"
      aria-label={`Day timeline: ${scheduledH} hours scheduled across ${parsed.length} blocks; the rest is reserve`}
    >
      <div className="tl-track" style={{ ['--hours' as string]: hours }}>
        {parsed.map((b, i) => {
          const st = blockStatus[String(b.idx)]
          return (
            <div
              key={b.idx}
              role="button"
              tabIndex={0}
              aria-label={`${b.start} to ${b.end}: ${b.label}${st ? ` (${st})` : ''}. Jump to details.`}
              className={`tl-block${hotIdx === b.idx ? ' hot' : ''}${st ? ` is-${st}` : ''}`}
              style={{
                ['--i' as string]: i,
                left: `${((b.s - dayStart) / span) * 100}%`,
                width: `${((b.e - b.s) / span) * 100}%`,
              }}
              title={`${b.start}-${b.end} ${b.label}: ${b.intent}`}
              onMouseEnter={() => onHot(b.idx)}
              onMouseLeave={() => onHot(null)}
              onFocus={() => onHot(b.idx)}
              onBlur={() => onHot(null)}
              onClick={() => onJump(b.idx)}
              onKeyDown={(e) => e.key === 'Enter' && onJump(b.idx)}
            >
              <span>{st === 'done' ? '✓ ' : ''}{b.label}</span>
            </div>
          )
        })}
        {nowPct !== null && (
          <div className="tl-now" style={{ left: `${nowPct}%` }} title="Now">
            <i />
          </div>
        )}
        {busy && <div className="tl-scan" aria-hidden="true" />}
      </div>
      <div className="tl-hours" aria-hidden="true">
        {hourLabels.map((h) => (
          <span
            key={h.label}
            style={{
              left: `${h.pct}%`,
              transform: h.pct === 0 ? 'none' : h.pct === 100 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {h.label}
          </span>
        ))}
      </div>
      <div className="tl-legend">
        <span>
          <i className="chip chip-block" /> scheduled &middot; {scheduledH}h in {parsed.length} blocks
          {doneCount > 0 && <> &middot; {doneCount} done</>}
        </span>
        <span>
          <i className="chip chip-reserve" /> reserve &middot; left open on purpose, because
          days never go to plan
        </span>
        {nowPct !== null && (
          <span>
            <i className="chip chip-now" /> now
          </span>
        )}
      </div>
    </div>
  )
}

export function ParaHead({ num, title, plain }: { num: string; title: string; plain: string }) {
  const id = `para-${num}`
  return (
    <div className="para-head">
      <span className="para-num" aria-hidden="true">
        {num}
      </span>
      <h3 className="para-title" id={id}>
        {title}
      </h3>
      <span className="para-plain">{plain}</span>
    </div>
  )
}

export default function SitrepView({
  active,
  onOpenDebrief,
}: {
  active: boolean
  onOpenDebrief: () => void
}) {
  const [sitrep, setSitrep] = useState<Sitrep | null>(null)
  const [blockStatus, setBlockStatus] = useState<BlockStatus>({})
  const [revision, setRevision] = useState(0)
  const [generatedAt, setGeneratedAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [replanning, setReplanning] = useState(false)
  const [replanOpen, setReplanOpen] = useState(false)
  const [replanNote, setReplanNote] = useState('')
  const [stagesReached, setStagesReached] = useState(0)
  const [justGenerated, setJustGenerated] = useState(false)
  const [hotIdx, setHotIdx] = useState<number | null>(null)
  const [busyBlock, setBusyBlock] = useState<number | null>(null)
  const [closedIds, setClosedIds] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const stageTimer = useRef<number | undefined>(undefined)
  const blockRefs = useRef<(HTMLDivElement | null)[]>([])
  const replanInput = useRef<HTMLInputElement | null>(null)

  const busy = loading || replanning

  const load = async () => {
    try {
      const res = await api.latestSitrep()
      setSitrep(res.sitrep?.body ?? null)
      setBlockStatus(res.sitrep?.block_status ?? {})
      setRevision(res.sitrep?.revision ?? 0)
      setGeneratedAt(res.sitrep?.created_at ?? '')
      setJustGenerated(false)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  const runStages = (count: number) => {
    setStagesReached(1)
    stageTimer.current = window.setInterval(
      () => setStagesReached((s) => Math.min(s + 1, count)),
      7000,
    )
  }

  const generate = async () => {
    setLoading(true)
    setError('')
    runStages(GENERATION_STAGES.length)
    try {
      const res = await api.generateSitrep()
      setSitrep(res.sitrep)
      setBlockStatus({})
      setRevision(0)
      setClosedIds({})
      setGeneratedAt(new Date().toISOString())
      setJustGenerated(true)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      window.clearInterval(stageTimer.current)
      setLoading(false)
    }
  }

  const replan = async () => {
    setReplanning(true)
    setError('')
    runStages(REPLAN_STAGES.length)
    try {
      const res = await api.replanSitrep(replanNote.trim())
      setSitrep(res.sitrep)
      setBlockStatus(res.sitrep?.block_status ?? {})
      setRevision(res.sitrep?.revision ?? revision + 1)
      setGeneratedAt(new Date().toISOString())
      setJustGenerated(true)
      setReplanOpen(false)
      setReplanNote('')
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      window.clearInterval(stageTimer.current)
      setReplanning(false)
    }
  }

  const markBlock = async (idx: number, status: 'done' | 'skipped' | null) => {
    if (!sitrep || busyBlock !== null) return
    const prev = blockStatus
    const next = { ...blockStatus }
    if (status === null) delete next[String(idx)]
    else next[String(idx)] = status
    setBlockStatus(next) // optimistic; the day should feel immediate
    setBusyBlock(idx)
    try {
      const res = await api.setBlockStatus(sitrep.date, idx, status)
      setBlockStatus(res.block_status)
    } catch (e) {
      setBlockStatus(prev)
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusyBlock(null)
    }
  }

  const closeTask = async (taskId: string, title: string) => {
    try {
      await api.updateTask(taskId, { status: 'done' })
      setClosedIds((c) => ({ ...c, [taskId]: true }))
    } catch (e) {
      setError(`Could not mark "${title}" done: ${e instanceof Error ? e.message : e}`)
    }
  }

  const reopenTask = async (taskId: string) => {
    try {
      await api.updateTask(taskId, { status: 'open' })
      setClosedIds((c) => {
        const next = { ...c }
        delete next[taskId]
        return next
      })
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  const challengeDrop = (title: string) => {
    setReplanOpen(true)
    setReplanNote(`Do not drop "${title}" today. Make room for it and tell me what gives way.`)
    window.setTimeout(() => replanInput.current?.focus(), 50)
  }

  // Views stay mounted across tab switches; refetch on activation so the
  // scheduled morning plan (or one generated elsewhere) is never stale here.
  useEffect(() => {
    if (active && !busy) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => () => window.clearInterval(stageTimer.current), [])

  const jumpToBlock = (i: number) => {
    const el = blockRefs.current[i]
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    setHotIdx(i)
    window.setTimeout(() => setHotIdx(null), 1600)
  }

  const isToday = sitrep?.date === todayLocalISO()
  const warn = sitrep?.command_signal?.overcommitment_warning
  const hasWarn = Boolean(warn && String(warn).trim().toLowerCase() !== 'null')
  const prios = sitrep?.execution?.priorities
  const prioMeta = {
    p1: { label: 'P1', plain: 'do these first' },
    p2: { label: 'P2', plain: 'then these' },
    p3: { label: 'P3', plain: 'if the day allows' },
  } as const
  const cs = sitrep?.command_signal
  const hasSignal = Boolean(
    cs?.decision_points?.length || cs?.blockers_to_escalate?.length || cs?.say_no_to?.length || hasWarn,
  )
  const stages = replanning ? REPLAN_STAGES : GENERATION_STAGES

  return (
    <div>
      <div className="view-head">
        <div>
          <span className="kicker">today's game plan</span>
          <h2>{sitrep ? sitrep.date : 'No game plan yet'}</h2>
          {generatedAt && sitrep && (
            <p className="lede mono" style={{ fontSize: '0.7rem' }}>
              {revision > 0
                ? `revision ${revision} · replanned ${new Date(generatedAt).toLocaleTimeString()}`
                : `generated ${new Date(generatedAt).toLocaleString()}`}{' '}
              &middot; amazon nova pro
            </p>
          )}
        </div>
        <div className="head-actions">
          {sitrep && isToday && (
            <button
              className="primary"
              onClick={() => {
                setReplanOpen((o) => !o)
                window.setTimeout(() => replanInput.current?.focus(), 50)
              }}
              disabled={busy}
              title="Keep the mission and the morning; rebuild only what remains"
            >
              Replan the rest of today
            </button>
          )}
          <button
            className={sitrep && isToday ? 'ghost' : 'primary'}
            onClick={generate}
            disabled={busy}
            title={sitrep ? 'Throw the whole plan away and write a new one' : undefined}
          >
            {loading ? 'Working' : sitrep ? 'Regenerate' : 'Generate game plan'}
          </button>
        </div>
      </div>

      {replanOpen && !busy && (
        <div className="replan-bar">
          <label className="kicker" htmlFor="replan-note">
            report in &mdash; what changed?
          </label>
          <div className="replan-row">
            <input
              id="replan-note"
              ref={replanInput}
              value={replanNote}
              placeholder='e.g. "finished the memo early; dentist ran long; new urgent ask from finance"'
              onChange={(e) => setReplanNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && replan()}
            />
            <button className="primary" onClick={replan}>
              Replan
            </button>
            <button
              className="ghost"
              onClick={() => {
                setReplanOpen(false)
                setReplanNote('')
              }}
            >
              Cancel
            </button>
          </div>
          <p className="hint">
            The mission stays. Finished blocks stay. Only the road ahead is redrawn.
          </p>
        </div>
      )}

      {busy && (
        <div className="genfeed" role="status" aria-label={replanning ? 'Replanning the rest of the day' : 'Generating the game plan'}>
          {stages.slice(0, stagesReached).map((s, i) => (
            <p className={`genline${i === stagesReached - 1 ? ' live' : ''}`} key={s}>
              <span className="genmark" aria-hidden="true">
                {i === stagesReached - 1 ? '▸' : '✓'}
              </span>
              {s}
            </p>
          ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!sitrep && !loading && (
        <div className="explainer">
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
            <strong>3.</strong> As the day moves, mark blocks done or skipped and
            report changes; the plan renegotiates the rest of the day around reality.
          </p>
          <p>
            <strong>4.</strong> In the evening, answer three short questions in the
            Debrief tab. Patterns in your answers become preferences that shape
            every future game plan.
          </p>
        </div>
      )}

      {sitrep && (
        <div className={justGenerated ? 'plan plan-reveal' : 'plan'}>
          {!!sitrep.execution?.time_blocks?.length && (
            <DayTimeline
              blocks={sitrep.execution.time_blocks}
              blockStatus={blockStatus}
              isToday={isToday}
              busy={busy}
              hotIdx={hotIdx}
              onHot={setHotIdx}
              onJump={jumpToBlock}
            />
          )}

          {hasWarn && (
            <div className="warn-banner" role="alert">
              <span className="kicker">overcommitment warning</span>
              {warn}
            </div>
          )}

          {!!sitrep.situation?.overview && (
            <section className="para" style={{ ['--i' as string]: 1 }} aria-labelledby="para-1">
              <ParaHead num="1" title="Situation" plain="where things stand" />
              <p>{sitrep.situation.overview}</p>
              {!!sitrep.situation.changes_since_yesterday?.length && (
                <ul>
                  {sitrep.situation.changes_since_yesterday.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {!!sitrep.mission?.statement && (
            <section className="para" style={{ ['--i' as string]: 2 }} aria-labelledby="para-2">
              <ParaHead num="2" title="Mission" plain="the one thing that matters most today" />
              <p className="mission-statement">{sitrep.mission.statement}</p>
              <p className="mission-why">{sitrep.mission.why_decisive}</p>
            </section>
          )}

          <section className="para" style={{ ['--i' as string]: 3 }} aria-labelledby="para-3">
            <ParaHead num="3" title="Execution" plain="the plan: time blocks, priorities, deliberate cuts" />
            <div className="blocks">
              {sitrep.execution?.time_blocks?.map((b, i) => {
                const st = blockStatus[String(i)]
                return (
                  <div
                    className={`block${hotIdx === i ? ' hot' : ''}${st ? ` is-${st}` : ''}`}
                    key={i}
                    ref={(el) => {
                      blockRefs.current[i] = el
                    }}
                    onMouseEnter={() => setHotIdx(i)}
                    onMouseLeave={() => setHotIdx(null)}
                  >
                    <span className="when">
                      {b.start}&ndash;{b.end}
                    </span>
                    <span className="what">
                      {st === 'done' && <span className="done-mark" aria-hidden="true">{'✓ '}</span>}
                      {b.label}
                      {st === 'skipped' && <span className="skip-note"> &middot; skipped</span>}
                    </span>
                    {isToday && (
                      <span className="block-actions">
                        {!st && (
                          <>
                            <button
                              className="mini ghost"
                              disabled={busyBlock !== null}
                              aria-label={`Mark block "${b.label}" done`}
                              onClick={() => markBlock(i, 'done')}
                            >
                              Done
                            </button>
                            <button
                              className="mini ghost"
                              disabled={busyBlock !== null}
                              aria-label={`Mark block "${b.label}" skipped`}
                              onClick={() => markBlock(i, 'skipped')}
                            >
                              Skip
                            </button>
                          </>
                        )}
                        {st && (
                          <button
                            className="mini ghost"
                            disabled={busyBlock !== null}
                            aria-label={`Clear the ${st} mark on "${b.label}"`}
                            onClick={() => markBlock(i, null)}
                          >
                            Undo
                          </button>
                        )}
                      </span>
                    )}
                    <span className="intent">{b.intent}</span>
                  </div>
                )
              })}
            </div>
            {(['p1', 'p2', 'p3'] as const).map(
              (p) =>
                !!prios?.[p]?.length && (
                  <div key={p} className="prio-group">
                    <span className={`tag ${p}`}>
                      {prioMeta[p].label} &middot; {prioMeta[p].plain}
                    </span>
                    <div className="prio-items">
                      {prios[p].map((t, i) => {
                        const closed = t.task_id ? closedIds[t.task_id] : false
                        return (
                          <span key={i} className={closed ? 'prio-closed' : undefined}>
                            {closed ? <s>{t.title}</s> : t.title}{' '}
                            <span className="reason">{t.reason}</span>
                            {isToday && t.task_id && !closed && (
                              <button
                                className="mini ghost inline-act"
                                aria-label={`Mark task "${t.title}" done`}
                                onClick={() => closeTask(t.task_id!, t.title)}
                              >
                                Done
                              </button>
                            )}
                            {closed && (
                              <button
                                className="mini ghost inline-act"
                                aria-label={`Reopen task "${t.title}"`}
                                onClick={() => reopenTask(t.task_id!)}
                              >
                                Undo
                              </button>
                            )}
                          </span>
                        )
                      })}
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
                      {isToday && (
                        <button
                          className="mini ghost inline-act"
                          aria-label={`Challenge the decision to drop "${d.title}"`}
                          title="Disagree? Send it back for renegotiation."
                          onClick={() => challengeDrop(d.title)}
                        >
                          Challenge
                        </button>
                      )}
                    </span>
                  ))}
                  <span className="group-plain">
                    cut so that today stays achievable; they return to the pool tomorrow.
                    Disagree with a cut? Challenge it and the plan renegotiates.
                  </span>
                </div>
              </div>
            )}
          </section>

          {!!sitrep.sustainment?.energy_plan && (
            <section className="para" style={{ ['--i' as string]: 4 }} aria-labelledby="para-4">
              <ParaHead num="4" title="Sustainment" plain="pacing: energy and breaks" />
              <p>{sitrep.sustainment.energy_plan}</p>
              {!!sitrep.sustainment.breaks?.length && (
                <ul>
                  {sitrep.sustainment.breaks.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {hasSignal && (
            <section className="para" style={{ ['--i' as string]: 5 }} aria-labelledby="para-5">
              <ParaHead
                num="5"
                title="Command &amp; Signal"
                plain="decisions to watch for, blockers to raise, requests to decline"
              />
              {cs?.decision_points?.map((d, i) => (
                <div className="signal-row" key={`dp${i}`}>
                  <span className="tag p3">decision</span>
                  <span>{d}</span>
                </div>
              ))}
              {cs?.blockers_to_escalate?.map((b, i) => (
                <div className="signal-row" key={`bl${i}`}>
                  <span className="tag warn">blocker</span>
                  <span>{b}</span>
                </div>
              ))}
              {cs?.say_no_to?.map((s, i) => (
                <div className="signal-row" key={`no${i}`}>
                  <span className="tag drop">decline</span>
                  <span>{s}</span>
                </div>
              ))}
            </section>
          )}

          {!!sitrep.debrief_questions?.length && (
            <section className="para" style={{ ['--i' as string]: 6 }} aria-labelledby="para-+">
              <ParaHead num="+" title="This evening" plain="three questions about how today actually goes" />
              <ul>
                {sitrep.debrief_questions.map((q, i) => (
                  <li key={i} className="dim">
                    {q}
                  </li>
                ))}
              </ul>
              <button className="ghost" onClick={onOpenDebrief}>
                Open the debrief
              </button>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
