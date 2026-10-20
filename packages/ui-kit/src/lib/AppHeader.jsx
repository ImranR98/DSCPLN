// Shared app chrome: brand, optional function name, page-specific controls
// between the title and the action cluster, and a two-row meta strip.
//
// `actions` is the icon-button cluster (callers include ThemeToggle where
// appropriate). `children` covers search boxes/status text that some apps put
// in the top row. `meta`/`metaTools` render the second row.
export default function AppHeader({
  name = null,
  actions = null,
  meta = null,
  metaTools = null,
  className = '',
  brandHref = '/',
  children = null,
}) {
  const headerClass = ['app-header', className].filter(Boolean).join(' ')
  const hasMeta = meta !== null || metaTools !== null
  return (
    <header className={headerClass}>
      <div className="app-header__top">
        <h1>
          <a className="app-header__brand" href={brandHref}>D<span className="accent">$</span>CPLN</a>
          {name ? <> <span className="app-header__app">· {name}</span></> : null}
        </h1>
        {children}
        {actions ? <div className="app-header__actions">{actions}</div> : null}
      </div>
      {hasMeta ? (
        <div className="app-header__meta">
          {typeof meta === 'string' ? <span className="muted">{meta}</span> : meta}
          {metaTools ? (
            <span className="app-header__meta-tools">
              {typeof metaTools === 'string' ? <span className="muted">{metaTools}</span> : metaTools}
            </span>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}
