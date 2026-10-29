import { useSync } from '@tldraw/sync'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite.js'
import { PageRecordType, Tldraw, useEditor, useValue, type TLAssetStore, type TLPageId } from 'tldraw'
import type { BoardSummary } from '../shared/boards.js'

const assets: TLAssetStore = {
  async upload() { throw new Error('Asset uploads are not implemented yet.') },
  resolve(asset) { return asset.props.src },
}
const assetUrls = getAssetUrlsByImport()

function PageControls() {
  const editor = useEditor()
  const pages = useValue('pages', () => editor.getPages(), [editor])
  const currentPage = useValue('current page', () => editor.getCurrentPageId(), [editor])
  const readOnly = useValue('read only', () => editor.getIsReadonly(), [editor])
  return (
    <div className="page-controls">
      <label>Page <select aria-label="Current page" value={currentPage}
        onChange={(event) => editor.setCurrentPage(event.target.value as TLPageId)}>
        {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
      </select></label>
      {!readOnly && <button type="button" onClick={() => {
        const id = PageRecordType.createId()
        editor.createPage({ id, name: `Page ${pages.length + 1}` })
        editor.setCurrentPage(id)
      }}>New page</button>}
    </div>
  )
}
const components = { TopPanel: PageControls }

export function BoardEditor({ board }: { board: BoardSummary }) {
  const uri = new URL(`/sync/${encodeURIComponent(board.id)}`, window.location.origin)
  uri.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const store = useSync({ uri: uri.toString(), assets })
  return <div className="editor">
    <Tldraw store={store} assetUrls={assetUrls} components={components}
      licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
      onMount={(editor) => { editor.updateInstanceState({ isReadonly: board.role === 'viewer' }) }} />
  </div>
}
