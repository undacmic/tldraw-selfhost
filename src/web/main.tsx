import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import 'tldraw/tldraw.css'
import './style.css'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(<App />)
