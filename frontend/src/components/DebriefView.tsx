import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

interface Analysis {
  summary: string
  mission_accomplished: boolean
  what_worked?: string[]
  what_slipped?: { item: string; proximate_cause: string }[]
  candidate_preferences?: { text: string; confidence: string }[]
  tomorrow_note?: string
}

const DRAFT_KEY = 'sitrep-debrief-draft'

interface Draft {
  planDate: string
  answers: Record<string, string>
}

function loadDraft(): Draft {
  try {
    const raw = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}')
    return {
      planDate: typeof raw.planDate === 'string' ? raw.planDate : '',
      answers: raw.answers && typeof raw.answers === 'object' ? raw.answers : {},
    }
  } catch {
    return { planDate: '', answers: {} }
  }
}

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DebriefView({ active }: { active: boolean }) {
  const [questions, setQuestions] = useState<string[]>([])
  const [planDate, setPlanDate] = useState('')
  // Draft survives tab switches (mounted view) AND full reloads
  // (sessionStorage); it is bound to a plan date so answers written about
  // one plan can never pre-fill the questions of another.
  const [answers, setAnswers] = useState<Record<string, string>>(() => loadDraft().answers)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  const fetchQuestions = () => {
    api
      .latestSitrep()
      .then((res) => {
        const date = res.sitrep?.body?.date ?? ''
        setQuestions(res.sitrep?.body?.debrief_questions ?? [])
        setPlanDate(date)
        // Answers drafted against a different plan are stale evidence:
        // discard rather than pre-fill the new questions with them.
        const draft = loadDraft()
        if (draft.planDate && draft.planDate !== date) {
          setAnswers({})
          sessionStorage.removeItem(DRAFT_KEY)
        }
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoaded(true))
  }

  // Refetch when the tab becomes active: a plan generated while this view
  // sat hidden should replace the stale questions.
  useEffect(() => {
    if (active && !analysis && !busy) fetchQuestions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ planDate, answers }))
  }, [answers, planDate])

  useEffect(() => {
    if (analysis) headingRef.current?.focus()
  }, [analysis])

  const canSubmit = questions.some((_, i) => (answers[`q${i + 1}`] ?? '').trim().length > 0)

  const submit = async () => {
    if (!canSubmit || busy) return
    setBusy(true)
    setError('')
    try {
      const trimmed = Object.fromEntries(
        Object.entries(answers).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v),
      )
      const res = await api.debrief(trimmed)
      setAnalysis(res.analysis)
      setAnswers({})
      sessionStorage.removeItem(DRAFT_KEY)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const stalePlan = planDate && planDate !== todayLocalISO()

  if (analysis) {
    return (
      <div className="aar">
        <div className="view-head">
          <div>
            <span className="kicker">after-action review</span>
            <h2 tabIndex={-1} ref={headingRef}>
              How today actually went
            </h2>
          </div>
          <button className="ghost" onClick={() => setAnalysis(null)}>
            Back to questions
          </button>
        </div>

        <p className={`verdict ${analysis.mission_accomplished ? 'ok' : 'miss'}`}>
          {analysis.mission_accomplished ? 'Mission accomplished' : 'Mission not accomplished'}
        </p>
        <p>{analysis.summary}</p>

        {!!analysis.what_worked?.length && (
          <section className="para">
            <div className="para-head">
              <h3 className="para-title">What worked</h3>
            </div>
            <ul>
              {analysis.what_worked.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </section>
        )}

        {!!analysis.what_slipped?.length && (
          <section className="para">
            <div className="para-head">
              <h3 className="para-title">What slipped</h3>
              <span className="para-plain">and the immediate cause, not the excuse</span>
            </div>
            <ul>
              {analysis.what_slipped.map((s, i) => (
                <li key={i}>
                  {s.item} <span className="dim">&mdash; {s.proximate_cause}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!!analysis.candidate_preferences?.length && (
          <div className="learned">
            <div className="para-head">
              <h3 className="para-title">What it learned about you</h3>
              <span className="para-plain">only patterns with repeated evidence are kept</span>
            </div>
            {analysis.candidate_preferences.map((p, i) => (
              <div className="learned-item" key={i} style={{ ['--i' as string]: i }}>
                <span className={`tag ${p.confidence === 'high' ? 'ok' : 'p3'}`}>
                  {p.confidence}
                </span>
                <span>
                  {p.text}
                  {p.confidence === 'high' && (
                    <span className="saved">
                      {' '}
                      &mdash; saved to your profile; it will shape tomorrow&rsquo;s plan
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {analysis.tomorrow_note && (
          <p className="dim">
            Tomorrow&rsquo;s planner reads this first: &ldquo;{analysis.tomorrow_note}&rdquo;
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="view-head">
        <div>
          <span className="kicker">evening debrief</span>
          <h2>Three questions about today</h2>
          <p className="lede">
            {stalePlan ? (
              <>
                From the plan of <span className="mono">{planDate}</span> (no plan
                was generated today). Honest answers are what make the next plan
                smarter; this is the learning loop.
              </>
            ) : (
              <>
                Generated from this morning&rsquo;s game plan, so they are about
                your actual plan, not your day in general. Honest answers are what
                make tomorrow&rsquo;s plan smarter; this is the learning loop.
              </>
            )}
          </p>
        </div>
      </div>

      {!loaded && !error && (
        <p className="status-line" role="status">
          <span className="pulse" aria-hidden="true" />
          Fetching the day&rsquo;s questions&hellip;
        </p>
      )}

      {loaded && questions.length === 0 && !error && (
        <div className="empty">
          <span className="kicker">no game plan yet</span>
          Generate a game plan first; its three debrief questions will appear
          here in the evening.
        </div>
      )}

      {questions.map((q, i) => (
        <div key={i} className="q-card">
          <span className="q-num">
            question {i + 1} of {questions.length}
          </span>
          <label htmlFor={`q${i + 1}`}>{q}</label>
          <textarea
            id={`q${i + 1}`}
            rows={3}
            value={answers[`q${i + 1}`] ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [`q${i + 1}`]: e.target.value }))}
          />
        </div>
      ))}

      {questions.length > 0 && (
        <div className="row">
          <button className="primary" onClick={submit} disabled={busy || !canSubmit}>
            {busy ? 'Reviewing' : 'Submit debrief'}
          </button>
          {!canSubmit && <span className="hint">answer at least one question</span>}
        </div>
      )}
      {busy && (
        <p className="status-line" role="status">
          <span className="pulse" aria-hidden="true" />
          Comparing the plan against how the day actually went&hellip;
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
