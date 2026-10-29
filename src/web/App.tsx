import { useEffect, useState, type FormEvent } from 'react'
import type { BoardSummary } from '../shared/boards.js'
import { BoardEditor } from './BoardEditor.js'
import { api, invitationUrl } from './api.js'

const initialInvitation = new URLSearchParams(window.location.hash.slice(1)).get('invite')
// Remove secrets from browser history before making any requests.
if (initialInvitation) window.history.replaceState(null, '', window.location.pathname + window.location.search)
const initialBoard = new URLSearchParams(window.location.search).get('board')
  ?? new URLSearchParams(window.location.search).get('room')

function LinkBox({ label, link }: { label: string; link: string }) {
  const [copied, setCopied] = useState(false)
  return <div className="link-box">
    <label>{label}<input readOnly value={link} onFocus={(event) => event.currentTarget.select()} /></label>
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(link); setCopied(true) }
      catch { setCopied(false) }
    }}>{copied ? 'Copied' : 'Copy link'}</button>
  </div>
}

function InvitationPanel({ board, onClose }: { board: BoardSummary; onClose: () => void }) {
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [hours, setHours] = useState(24)
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function create(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const invite = await api<{ token: string; expiresAt: number }>(`/api/boards/${board.id}/invitations`, { role, hours })
      setLink(invitationUrl(invite.token))
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="invite-panel" aria-label="Board invitations">
    <div className="section-heading"><h2>Invite to {board.name}</h2><button onClick={onClose}>Close invitations</button></div>
    <p>Anyone with the link can join all pages of this board. Only share it with people you trust.</p>
    <form onSubmit={create}>
      <label>Permission <select aria-label="Invitation permission" value={role} onChange={(event) => {
        setRole(event.target.value as 'editor' | 'viewer'); setLink('')
      }}><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label>
      <label>Link expires in <select aria-label="Invitation expiry" value={hours} onChange={(event) => {
        setHours(Number(event.target.value)); setLink('')
      }}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option></select></label>
      <button disabled={busy}>Create invitation link</button>
    </form>
    {link && <LinkBox label="Invitation link" link={link} />}
    <p className="muted">Expiry prevents new joins. People who already joined retain access in this browser for up to 30 days. Links are reusable; revocation is not implemented yet.</p>
    {error && <p role="alert">{error}</p>}
  </section>
}

export function App() {
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [board, setBoard] = useState<BoardSummary>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [invitations, setInvitations] = useState(false)
  const [recovery, setRecovery] = useState('')

  function open(next?: BoardSummary) {
    setBoard(next); setInvitations(false); setError('')
    window.history.replaceState(null, '', next ? `/?board=${encodeURIComponent(next.id)}` : '/')
  }
  useEffect(() => {
    let cancelled = false
    async function load(invitation = initialInvitation, boardId = initialBoard) {
      try {
        let list = (await api<{ boards: BoardSummary[] }>('/api/boards')).boards
        if (!cancelled) setBoards(list)
        let selected: BoardSummary | undefined
        if (invitation) {
          selected = (await api<{ board: BoardSummary }>('/api/invitations/redeem', { token: invitation })).board
          list = (await api<{ boards: BoardSummary[] }>('/api/boards')).boards
        } else if (boardId) {
          selected = (await api<{ board: BoardSummary }>(`/api/boards/${encodeURIComponent(boardId)}`)).board
        }
        if (!cancelled) { setBoards(list); if (selected) open(selected) }
      } catch (error) { if (!cancelled) setError((error as Error).message) }
      finally { if (!cancelled) setLoading(false) }
    }
    function onInvitationNavigation() {
      const invitation = new URLSearchParams(window.location.hash.slice(1)).get('invite')
      if (!invitation) return
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setError(''); setLoading(true)
      void load(invitation, null)
    }
    window.addEventListener('hashchange', onInvitationNavigation)
    void load()
    return () => { cancelled = true; window.removeEventListener('hashchange', onInvitationNavigation) }
  }, [])

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await api<{ board: BoardSummary; recovery: { token: string } }>('/api/boards', { name })
      setBoards((boards) => [...boards, result.board]); setName('')
      setRecovery(invitationUrl(result.recovery.token)); open(result.board)
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }

  if (loading) return <main className="home"><p role="status">Opening your boards…</p></main>
  return <div className="workspace">
    {board ? <header className="board-header">
      <button onClick={() => open()}>Boards</button><h1>{board.name}</h1>
      <span className="role-badge">{board.role === 'viewer' ? 'View only' : board.role}</span>
      {board.role === 'owner' && <button onClick={() => setInvitations((value) => !value)}>Invite</button>}
    </header> : <header className="home-header"><h1>Your boards</h1><p>Separate boards, shared pages. Invite people without accounts.</p></header>}
    {error && <div className="notice" role="alert">{error}</div>}
    {recovery && <section className="notice" aria-label="Owner recovery">
      <strong>Save your private owner recovery link.</strong> It restores full ownership if you lose this browser's cookie. It expires in one year; do not share it with guests.
      <LinkBox label="Owner recovery link" link={recovery} />
      <button onClick={() => setRecovery('')}>I saved it</button>
    </section>}
    {board && invitations && <InvitationPanel board={board} onClose={() => setInvitations(false)} />}
    {board ? <BoardEditor key={board.id} board={board} /> : <main className="home">
      <form className="new-board" onSubmit={create}>
        <label>Board name <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Project ideas" /></label>
        <button disabled={busy || !name.trim()}>Create board</button>
      </form>
      <p className="muted">Your access is saved in this browser for 30 days. Keep your owner recovery links somewhere safe.</p>
      {boards.length ? <ul className="board-list">{boards.map((entry) => <li key={entry.id}>
        <button onClick={() => open(entry)}><span>{entry.name}</span><span className="role-badge">{entry.role}</span></button>
      </li>)}</ul> : <p>No boards yet. Create one or open an invitation link.</p>}
    </main>}
  </div>
}
