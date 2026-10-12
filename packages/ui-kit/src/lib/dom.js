// Svelte actions for the shared UI.

// Wraps long money strings at thousands separators, the decimal point and
// every third fraction digit so they break at sensible points.
export function setBreakableText(element, text) {
  element.textContent = ''
  let start = 0
  let inFraction = false
  let sinceBreak = 0
  const addBreak = (index) => {
    element.append(document.createTextNode(text.slice(start, index + 1)))
    element.append(document.createElement('wbr'))
    start = index + 1
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === ',' || char === '.') {
      inFraction = char === '.'
      sinceBreak = 0
      addBreak(i)
    } else if (inFraction && char >= '0' && char <= '9') {
      sinceBreak += 1
      if (sinceBreak === 3) {
        sinceBreak = 0
        addBreak(i)
      }
    }
  }
  element.append(document.createTextNode(text.slice(start)))
}

// <span use:breakable={money(...)}></span>
export function breakable(element, text) {
  const update = (value) => setBreakableText(element, String(value ?? ''))
  update(text)
  return {
    update,
    destroy() {
      element.textContent = ''
    },
  }
}
