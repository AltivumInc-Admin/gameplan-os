import { useEffect, useState } from 'react'
import { hasCredentials, setKey } from './api'
import { signOut as cognitoSignOut } from './auth'
import AgentDock from './components/AgentDock'
import Landing from './components/Landing'
import ThemeToggle from './components/ThemeToggle'
import SitrepView from './components/SitrepView'
import TasksView from './components/TasksView'
import DebriefView from './components/DebriefView'
import MemoryView from './components/MemoryView'

type Tab = 'brief' | 'tasks' | 'debrief' | 'memory'

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

function Brand({ onHome }: { onHome?: () => void }) {
  return (
    <button className="brand" type="button" onClick={onHome} title="Back to the homepage">
      <span className="brand-mark" aria-hidden="true" />
      <span className="brand-name">GAME PLAN OS</span>
      <span className="brand-sub">your daily game plan</span>
    </button>
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

const TABS: { id: Tab; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'debrief', label: 'Debrief' },
  { id: 'memory', label: 'Memory' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('brief')
  const [authed, setAuthed] = useState(hasCredentials())
  // The homepage always loads first; the console is a place you go, not a
  // screen you are trapped in. (Signed-in visitors previously never saw the
  // landing page at all.)
  const [view, setView] = useState<'landing' | 'console'>('landing')

  useEffect(() => {
    const onUnauthorized = () => {
      setAuthed(false)
      setView('landing')
    }
    window.addEventListener('sitrep-unauthorized', onUnauthorized)
    return () => window.removeEventListener('sitrep-unauthorized', onUnauthorized)
  }, [])

  if (view === 'landing' || !authed) {
    return (
      <Landing
        authed={authed}
        onEnter={() => {
          setAuthed(true)
          setView('console')
        }}
      />
    )
  }

  const signOut = () => {
    void cognitoSignOut()
    setKey('')
    setAuthed(false)
    setView('landing')
  }

  return (
    <div className="shell">
      <header className="top">
        <Brand onHome={() => setView('landing')} />
        <div className="top-right">
          <Clock />
          <ThemeToggle />
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
        <div className={tab === 'memory' ? 'view view-active' : 'view'} hidden={tab !== 'memory'}>
          <MemoryView active={tab === 'memory'} />
        </div>
      </main>
      <AgentDock />
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
            title="End this session on this browser"
          >
            sign out
          </button>
        </span>
      </footer>
    </div>
  )
}
