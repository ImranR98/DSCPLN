'use strict'

// Applies the stored theme before the first paint (loaded synchronously in
// <head>), so the page never flashes the wrong color scheme.
;(function () {
    try {
        const stored = localStorage.getItem('dscpln-theme')
        const theme = stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto'
        const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
        document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    } catch (e) { }
})()
