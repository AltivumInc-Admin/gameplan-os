import { useEffect, useState } from 'react'
import { api, getKey, setKey } from './api'
import SitrepView from './components/SitrepView'
import TasksView from './components/TasksView'
import DebriefView from './components/DebriefView'

type Tab = 'brief' | 'tasks' | 'debrief'

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true" />
      <span className="brand-name">GAME PLAN OS</span>
      <span className="brand-sub">your daily game plan</span>
    </div>
  )
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return (
    <span className="clock" title="Your local time">
      {hh}:{mm}:{ss} {TZ}
    </span>
  )
}

function Gate({ onEnter }: { onEnter: () => void }) {
  const [value, setValue] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    const key = value.trim()
    if (!key || checking) return
    setChecking(true)
    setError('')
    setKey(key)
    try {
      // Probe a cheap authenticated endpoint so a wrong key fails here,
      // at the gate, instead of as cryptic errors inside every view.
      await api.tasks('open')
      onEnter()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="gate-wrap">
      <div className="radar" aria-hidden="true" />
      <div className="gate">
        <div className="rise" style={{ ['--i' as string]: 0 }}>
          <Brand />
        </div>
        <h1 className="rise" style={{ ['--i' as string]: 1 }}>
          A one-page game plan for the day, written for you every morning.
        </h1>
        <p className="intro rise" style={{ ['--i' as string]: 2 }}>
          Game Plan OS reads your open tasks, what it has learned about how you
          work, and how yesterday actually went. Then it makes decisions: one
          mission for the day, a timed plan with deliberate breathing room, and
          a short list of things it chose to drop, with reasons. In the evening
          it asks three questions and learns from your answers.
        </p>
        <p className="term rise" style={{ ['--i' as string]: 3 }}>
          The format is borrowed, in spirit, from the military five-paragraph
          operations order: where things stand, one mission, the plan, pacing,
          and the calls you may need to make. No military background needed;
          it is simply a disciplined way to decide.
        </p>
        <div className="key-row rise" style={{ ['--i' as string]: 4 }}>
          <input
            type="password"
            value={value}
            placeholder="access key"
            aria-label="Access key"
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button className="primary" onClick={submit} disabled={checking}>
            {checking ? 'Checking' : 'Enter'}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="key-hint rise" style={{ ['--i' as string]: 5 }}>
          This is the key you chose when deploying the backend. It is stored
          only in this browser.
        </p>
      </div>
    </div>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'debrief', label: 'Debrief' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('brief')
  const [authed, setAuthed] = useState(Boolean(getKey()))

  useEffect(() => {
    const onUnauthorized = () => setAuthed(false)
    window.addEventListener('sitrep-unauthorized', onUnauthorized)
    return () => window.removeEventListener('sitrep-unauthorized', onUnauthorized)
  }, [])

  if (!authed) return <Gate onEnter={() => setAuthed(true)} />

  const signOut = () => {
    setKey('')
    setAuthed(false)
  }

  return (
    <div className="shell">
      <header className="top">
        <Brand />
        <div className="top-right">
          <Clock />
          <nav className="tabs" aria-label="Views">
            {TABS.map((t) => (
              <button
                key={t.id}
                aria-current={tab === t.id ? 'true' : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {/* Views stay mounted so in-progress work (a half-typed debrief,
            a drafted dump) survives tab switches. */}
        <div className={tab === 'brief' ? 'view view-active' : 'view'} hidden={tab !== 'brief'}>
          <SitrepView active={tab === 'brief'} onOpenDebrief={() => setTab('debrief')} />
        </div>
        <div className={tab === 'tasks' ? 'view view-active' : 'view'} hidden={tab !== 'tasks'}>
          <TasksView active={tab === 'tasks'} />
        </div>
        <div className={tab === 'debrief' ? 'view view-active' : 'view'} hidden={tab !== 'debrief'}>
          <DebriefView active={tab === 'debrief'} />
        </div>
      </main>
      <footer className="bottom">
        <span>
          Amazon Bedrock (Nova) &middot; Lambda &middot; DynamoDB &middot;
          EventBridge Scheduler &middot; SES &middot; Amplify Hosting
        </span>
        <span>
          <a href="https://github.com/AltivumInc-Admin/gameplan-os">source</a>
          {' '}&middot;{' '}
          <button
            className="mini ghost"
            onClick={signOut}
            title="Forget the access key stored in this browser"
          >
            change key
          </button>
        </span>
      </footer>
    </div>
  )
}
