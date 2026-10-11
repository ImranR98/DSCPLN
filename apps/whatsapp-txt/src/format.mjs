// Timestamp formatting helpers shared by the parser and the UI.

export const twoDigits = (num) => (num <= 9 ? '0' : '') + num.toString()

// Gets a YYYYMMDD string from a timestamp
export const ts2ds = (ts) => {
    const dat = new Date(ts)
    return `${dat.getFullYear()}${twoDigits(dat.getMonth() + 1)}${twoDigits(dat.getDate())}`
}

// Formats a timestamp for display
export const ts2display = (ts) => {
    const d = new Date(ts)
    return `${d.getFullYear()}/${twoDigits(d.getMonth() + 1)}/${twoDigits(d.getDate())}`
}

// Message body classifiers
