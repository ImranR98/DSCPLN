import { X } from 'lucide-react'

export default function Banner({ text, visible, onDismiss }) {
  return (
    <div id="banner" className="banner" role="alert" hidden={!visible}>
      <span id="banner-text">{text}</span>
      <button id="banner-close" className="icon-btn" aria-label="Dismiss notification" onClick={onDismiss}>
        <X size={15} strokeWidth={1.8} />
      </button>
    </div>
  )
}
