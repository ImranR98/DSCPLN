#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '@dscpln/server-kit'

// Portal: the D$CPLN root page. Always served at the host root (BASE_PATH is
// intentionally ignored); it links to every function subpath.

const here = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT ?? 8080)
const host = process.env.HOST ?? '0.0.0.0'

const app = createApp({
  title: 'Portal',
  pageTitle: 'D$CPLN',
  basePath: '',
  staticDir: path.join(here, 'static'),
})

app.listen(port, host, () => {
  console.log(`D$CPLN portal listening on http://${host}:${port}`)
})
