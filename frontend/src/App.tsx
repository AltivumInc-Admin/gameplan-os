import { useEffect, useState } from 'react'
import { getKey, setKey } from './api'
import Landing from './components/Landing'
import ThemeToggle from './components/ThemeToggle'
import SitrepView from './components/SitrepView'
import TasksView from './components/TasksView'
import DebriefView from './components/DebriefView'
import MemoryView from './components/MemoryView'

type Tab = 'brief' | 'tasks' | 'debrief' | 'memory'

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

const TABS: { id: Tab; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'debrief', label: 'Debrief' },
  { id: 'memory', label: 'Memory' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('brief')
  const [authed, setAuthed] = useState(Boolean(getKey()))

  useEffect(() => {
    const onUnauthorized = () => setAuthed(false)
    window.addEventListener('sitrep-unauthorized', onUnauthorized)
    return () => window.removeEventListener('sitrep-unauthorized', onUnauthorized)
  }, [])

  if (!authed) return <Landing onEnter={() => setAuthed(true)} />

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
