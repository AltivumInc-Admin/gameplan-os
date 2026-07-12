import { useEffect, useRef, useState } from 'react'
import { api, setKey, type BlockStatus } from '../api'
import { cognitoConfigured, completeNewPassword, signIn } from '../auth'
import ThemeToggle from './ThemeToggle'
import { DayTimeline, ParaHead, type Sitrep } from './SitrepView'
import heroLarge from '../assets/hero-dawn.jpg'
import heroSmall from '../assets/hero-dawn-sm.jpg'

// ---------------------------------------------------------------------------
// The front door. Structured as the product's own five-paragraph order:
// the page practices what the console preaches. Hero art: dawn terrain with
// a plotted route — the plan drawn before the world wakes.
// ---------------------------------------------------------------------------

const HEADLINE = 'The day, decided before you wake.'
const GLYPHS = '▘▝▖▗▚▞█▓▒░/\\|-+·'

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** One-shot decode: characters resolve left to right out of map-glyph noise. */
function DecodeHeadline() {
  const [text, setText] = useState(() => (reducedMotion() ? HEADLINE : ''))
  useEffect(() => {
    if (reducedMotion()) return
    let frame = 0
    const perChar = 2.2 // frames each character spends scrambled
    const id = window.setInterval(() => {
      frame += 1
      const resolved = Math.floor(frame / perChar)
      if (resolved >= HEADLINE.length) {
        setText(HEADLINE)
        window.clearInterval(id)
        return
      }
      let out = HEADLINE.slice(0, resolved)
      const tail = Math.min(HEADLINE.length - resolved, 10)
      for (let i = 0; i < tail; i += 1) {
        const target = HEADLINE[resolved + i]
        out += target === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      }
      setText(out)
    }, 24)
    return () => window.clearInterval(id)
  }, [])
  return (
    <h1 className="hero-headline" aria-label={HEADLINE}>
      <span aria-hidden="true">{text}</span>
    </h1>
  )
}

// ---------------------------------------------------------------------------
// Sample brief: a realistic morning, rendered by the real console components.
// Interactive locally — nothing here touches the backend.
// ---------------------------------------------------------------------------

const DEMO: Sitrep = {
  date: 'sample',
  mission: {
    statement: 'Ship the pricing proposal to the board by 16:00 — numbers verified, one page, sent.',
    why_decisive: "It unblocks Monday's board meeting; everything else today can flex around it.",
  },
  execution: {
    time_blocks: [
      {
        start: '08:30', end: '10:30',
        label: 'Pricing proposal — deep work',
        intent: 'Full draft with checked numbers. No email before this.',
      },
      {
        start: '11:00', end: '12:00',
        label: 'Standup + unblock reviews',
        intent: 'Clear the two reviews blocking the release.',
      },
      {
        start: '13:30', end: '15:00',
        label: 'Proposal — review and send',
        intent: 'Read it cold, fix what reads wrong, send it.',
      },
      {
        start: '15:30', end: '16:30',
        label: 'Customer calls',
        intent: 'Two renewal check-ins; notes go back into the pool.',
      },
    ],
    priorities: {
      p1: [{ title: 'Pricing proposal to the board', reason: 'the mission; everything else flexes' }],
      p2: [{ title: 'Unblock the release reviews', reason: 'two people are waiting on you' }],
      p3: [{ title: 'Outline the conference talk', reason: 'only if the proposal ships early' }],
    },
    deliberately_dropped: [
      {
        title: 'Redesign the onboarding email sequence',
        reason: 'important, not urgent — it would eat the deep-work block. It returns tomorrow.',
      },
      {
        title: 'Inbox zero',
        reason: 'a two-hour cost for zero movement on the mission.',
      },
    ],
  },
}

function DemoBrief() {
  const [status, setStatus] = useState<BlockStatus>({})
  const [hotIdx, setHotIdx] = useState<number | null>(null)
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const blocks = DEMO.execution!.time_blocks!

  const jump = (i: number) => {
    refs.current[i]?.scrollIntoView({
      behavior: reducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    })
    setHotIdx(i)
    window.setTimeout(() => setHotIdx(null), 1600)
  }

  const cycle = (i: number) => {
    // Local, three-state toggle: unmarked -> done -> skipped -> unmarked.
    setStatus((s) => {
      const cur = s[String(i)]
      const next = { ...s }
      if (!cur) next[String(i)] = 'done'
      else if (cur === 'done') next[String(i)] = 'skipped'
      else delete next[String(i)]
      return next
    })
  }

  return (
    <div className="demo-brief" aria-label="Interactive sample of a morning brief">
      <DayTimeline
        blocks={blocks}
        blockStatus={status}
        isToday={false}
        busy={false}
        hotIdx={hotIdx}
        onHot={setHotIdx}
        onJump={jump}
      />

      <section className="para">
        <ParaHead num="2" title="Mission" plain="the one thing that matters most today" />
        <p className="mission-statement">{DEMO.mission!.statement}</p>
        <p className="mission-why">{DEMO.mission!.why_decisive}</p>
      </section>

      <section className="para">
        <ParaHead num="3" title="Execution" plain="time blocks, priorities, deliberate cuts" />
        <div className="blocks">
          {blocks.map((b, i) => {
            const st = status[String(i)]
            return (
              <div
                key={i}
                className={`block${hotIdx === i ? ' hot' : ''}${st ? ` is-${st}` : ''}`}
                ref={(el) => {
                  refs.current[i] = el
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
                <span className="block-actions">
                  <button
                    className="mini ghost"
                    aria-label={`Mark "${b.label}" done (sample data)`}
                    onClick={() => cycle(i)}
                  >
                    {!st ? 'Done' : st === 'done' ? 'Skip' : 'Reset'}
                  </button>
                </span>
                <span className="intent">{b.intent}</span>
              </div>
            )
          })}
        </div>
        {(['p1', 'p2', 'p3'] as const).map((p) => {
          const meta = { p1: 'do these first', p2: 'then these', p3: 'if the day allows' }[p]
          const items = DEMO.execution!.priorities![p]
          return (
            <div key={p} className="prio-group">
              <span className={`tag ${p}`}>
                {p.toUpperCase()} &middot; {meta}
              </span>
              <div className="prio-items">
                {items.map((t, i) => (
                  <span key={i}>
                    {t.title} <span className="reason">{t.reason}</span>
                  </span>
                ))}
              </div>
            </div>
          )
        })}
        <div className="prio-group">
          <span className="tag drop">dropped on purpose</span>
          <div className="prio-items">
            {DEMO.execution!.deliberately_dropped!.map((d, i) => (
              <span key={i}>
                <span className="dropped-title">{d.title}</span>{' '}
                <span className="reason">{d.reason}</span>
              </span>
            ))}
            <span className="group-plain">
              every cut comes with its reason — and in the console you can
              challenge one and the plan renegotiates the rest of the day
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------

function GateForm({ authed, onEnter }: { authed: boolean; onEnter: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  // A non-empty challenge session means the invitation's temporary password
  // was accepted and a permanent one must be chosen now.
  const [challenge, setChallenge] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  if (authed) {
    return (
      <div className="gate-form">
        <div className="key-row">
          <button className="primary" onClick={onEnter}>
            Open the console
          </button>
        </div>
        <p className="key-hint">You are signed in on this browser.</p>
      </div>
    )
  }

  const submit = async () => {
    if (checking) return
    setChecking(true)
    setError('')
    try {
      if (challenge) {
        if (newPassword.length < 8) throw new Error('Pick a password of at least 8 characters.')
        await completeNewPassword(email.trim(), newPassword, challenge)
        onEnter()
        return
      }
      if (!cognitoConfigured()) {
        // Local dev without Cognito build vars: the password field takes the
        // service key directly.
        setKey(password.trim())
        await api.tasks('open')
        onEnter()
        return
      }
      const outcome = await signIn(email.trim(), password)
      if (outcome.ok) {
        onEnter()
      } else {
        setChallenge(outcome.newPasswordSession)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setChecking(false)
    }
  }

  return (
    <form
      className="gate-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {challenge ? (
        <>
          <div className="gate-fields">
            <input
              type="password"
              name="new-password"
              id="new-password"
              autoComplete="new-password"
              value={newPassword}
              placeholder="choose a new password"
              aria-label="New password"
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button className="primary" type="submit" disabled={checking}>
              {checking ? 'Saving' : 'Set password and enter'}
            </button>
          </div>
          <p className="key-hint">
            First sign-in: replace the temporary password from your invitation
            email with one of your own.
          </p>
        </>
      ) : (
        <>
          <div className="gate-fields">
            {cognitoConfigured() && (
              <input
                type="email"
                name="email"
                id="email"
                autoComplete="username"
                value={email}
                placeholder="email"
                aria-label="Email"
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
            <div className="key-row">
              <input
                type="password"
                name="current-password"
                id="current-password"
                autoComplete="current-password"
                value={password}
                placeholder={cognitoConfigured() ? 'password' : 'access key'}
                aria-label={cognitoConfigured() ? 'Password' : 'Access key'}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="primary" type="submit" disabled={checking}>
                {checking ? 'Checking' : 'Sign in'}
              </button>
            </div>
          </div>
          {error === '' && (
            <p className="key-hint">
              Owner sign-in. Accounts are created by invitation; nothing here
              is shared infrastructure.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

export default function Landing({
  authed,
  onEnter,
}: {
  authed: boolean
  onEnter: () => void
}) {
  const heroImg = useRef<HTMLImageElement | null>(null)
  const gateRef = useRef<HTMLDivElement | null>(null)
  const demoRef = useRef<HTMLDivElement | null>(null)
  const [pastHero, setPastHero] = useState(false)

  // Subtle parallax while the hero is visible; past it, the fixed bar trades
  // its hero-dark chrome for the active theme's surface.
  useEffect(() => {
    const reduce = reducedMotion()
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const y = window.scrollY
        setPastHero(y > window.innerHeight * 0.72)
        if (!reduce && heroImg.current) {
          const clamped = Math.min(y, window.innerHeight)
          heroImg.current.style.transform = `translateY(${clamped * 0.18}px) scale(1.04)`
        }
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) =>
    ref.current?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' })

  return (
    <div className="landing">
      <header className={pastHero ? 'land-top scrolled' : 'land-top'}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">GAME PLAN OS</span>
        </div>
        <div className="land-top-right">
          <ThemeToggle />
          <button
            className="mini ghost"
            onClick={() => (authed ? onEnter() : scrollTo(gateRef))}
          >
            {authed ? 'Open console' : 'Sign in'}
          </button>
        </div>
      </header>

      <section className="hero" aria-label="Introduction">
        <img
          ref={heroImg}
          className="hero-art"
          src={heroLarge}
          srcSet={`${heroSmall} 1080w, ${heroLarge} 2560w`}
          sizes="100vw"
          alt="Aerial view of dark mountain ridgelines at dawn, overlaid with glowing map contour lines and a single plotted route winding toward the sunrise"
          fetchPriority="high"
        />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-copy">
          <p className="kicker hero-kicker rise" style={{ ['--i' as string]: 0 }}>
            a personal AI operations officer
          </p>
          <DecodeHeadline />
          <p className="hero-sub rise" style={{ ['--i' as string]: 3 }}>
            Most planning apps organize whatever you give them. Game Plan OS
            decides: one mission, a timed plan with room to breathe, and a
            defended list of what it cut &mdash; written for you every morning.
          </p>
          <div className="hero-cta rise" style={{ ['--i' as string]: 5 }}>
            <button className="primary" onClick={() => scrollTo(demoRef)}>
              See it decide
            </button>
            <button
              className="ghost hero-ghost"
              onClick={() => (authed ? onEnter() : scrollTo(gateRef))}
            >
              {authed ? 'Open the console' : 'Sign in'}
            </button>
          </div>
        </div>
        <p className="hero-stack mono" aria-hidden="true">
          Amazon Bedrock &middot; Lambda &middot; DynamoDB &middot; EventBridge &middot; SES &middot; Amplify
        </p>
      </section>

      <main className="land-body">
        <section className="land-para" aria-labelledby="para-1">
          <ParaHead num="1" title="Situation" plain="where things stand" />
          <p className="land-lede">
            Planning tools sit at two poles. Auto-schedulers pack your calendar
            until it looks full and call it a plan &mdash; they know when you
            are free, never what matters. Ritual planners hand you beautiful
            empty boxes and make you decide everything, every day. Both leave
            the hard part &mdash; judgment &mdash; to you, at seven in the
            morning, with a full inbox.
          </p>
        </section>

        <section className="land-para" aria-labelledby="para-2">
          <ParaHead num="2" title="Mission" plain="what this tool is for" />
          <p className="land-statement">One mission. One page. Every morning.</p>
          <div className="signal-row">
            <span className="tag p1">one mission</span>
            <span>
              A single decisive objective with a measurable end state.
              Everything else is supporting effort.
            </span>
          </div>
          <div className="signal-row">
            <span className="tag p2">room to breathe</span>
            <span>
              Never more than seventy percent of your hours scheduled. The rest
              is reserve, because days never go to plan.
            </span>
          </div>
          <div className="signal-row">
            <span className="tag drop">defended cuts</span>
            <span>
              An explicit list of what you are not doing today, each with a
              reason. Disagree with a cut? Challenge it, and the plan
              renegotiates.
            </span>
          </div>
        </section>

        <section className="land-para land-demo" aria-labelledby="para-3" ref={demoRef}>
          <ParaHead num="3" title="Execution" plain="a real brief, rendered live — try it" />
          <p className="land-lede">
            This is the console itself rendering a sample morning. Hover the
            timeline, jump to a block, mark one done. Format borrowed, in
            spirit, from the military five-paragraph order &mdash; no military
            background needed; it is simply a disciplined way to decide.
          </p>
          <DemoBrief />
        </section>

        <section className="land-para" aria-labelledby="para-4">
          <ParaHead num="4" title="Sustainment" plain="it learns how you work" />
          <p className="land-lede">
            Each evening it asks three questions about how the day actually
            went. Honest answers become an after-action review, and patterns
            with repeated evidence are kept &mdash; visible, editable, and
            quietly shaping every future plan.
          </p>
          <div className="memory-sample" aria-hidden="true">
            <div className="memory-item">
              <div className="memory-text">
                <span>Deep work lands before 10:00 &mdash; protect it.</span>
                <span className="memory-meta mono">learned from 4 debriefs</span>
              </div>
            </div>
            <div className="memory-item">
              <div className="memory-text">
                <span>Reviews take twice your estimate. Plan for it.</span>
                <span className="memory-meta mono">learned from 3 debriefs</span>
              </div>
            </div>
            <div className="memory-item">
              <div className="memory-text">
                <span>Calls before noon cost the whole morning.</span>
                <span className="memory-meta mono">learned from 2 debriefs</span>
              </div>
            </div>
          </div>
          <p className="land-loop mono">
            05:30 the brief arrives &rarr; work the day, report what changes
            &rarr; the plan renegotiates &rarr; evening debrief &rarr; tomorrow
            is sharper
          </p>
        </section>

        <section className="land-para land-gate" aria-labelledby="para-5" ref={gateRef}>
          <div className="radar" aria-hidden="true" />
          <ParaHead num="5" title="Command &amp; Signal" plain="take command" />
          <p className="land-lede">
            Game Plan OS is single-tenant by design: it runs on your own AWS
            account, and your tasks, plans, and debriefs never leave it. Sign
            in as the owner, or deploy your own from the source.
          </p>
          <GateForm authed={authed} onEnter={onEnter} />
          <p className="land-deploy">
            <a href="https://github.com/AltivumInc-Admin/gameplan-os">
              Deploy your own &mdash; source on GitHub
            </a>
          </p>
        </section>
      </main>

      <footer className="land-foot mono">
        <span>Game Plan OS &middot; built on AWS for the Builder Center weekend challenge</span>
        <span>Amazon Bedrock (Nova) &middot; Lambda &middot; DynamoDB &middot; EventBridge &middot; SES &middot; Amplify</span>
      </footer>
    </div>
  )
}
