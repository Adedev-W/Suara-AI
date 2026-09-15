import type { AssistantView } from '../lib/assistantController'
import { hintText } from '../lib/flow'

export function HintCard({ view, onClose }: { view: AssistantView; onClose: () => void }) {
  if (!view.hint || view.status === 'hidden') return null
  return <aside className={`hint-card${view.status === 'reading' ? ' is-reading' : ''}`} aria-label="Speaking suggestion">
    <div className="hint-card-header">
      <span className="hint-label">Continue with this</span>
      <button type="button" onClick={onClose} aria-label="Dismiss speaking suggestion">×</button>
    </div>
    <p className="hint-continuation" aria-live="polite">{hintText(view.hint)}</p>
    <small>{view.personalizing ? 'Preparing a tailored suggestion…' : 'Read along or use your own words.'}</small>
  </aside>
}
