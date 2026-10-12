import { createElement, useLayoutEffect, useRef } from 'react'
import { setBreakableText } from './dom.js'

// Wraps long money strings at thousands separators, the decimal point and
// every third fraction digit so they break at sensible points. Renders the
// same element the Svelte action wrapped (a span by default).
// <Breakable className="figure__spend" id="monthSpend" text={hero.spendText} />
// <Breakable as="strong" title={...} text={...} />
export default function Breakable({ as = 'span', text, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    if (ref.current) setBreakableText(ref.current, String(text ?? ''))
  }, [text])
  return createElement(as, { ref, ...rest })
}
