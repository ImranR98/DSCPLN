import { mount } from 'svelte'
import '@dscpln/ui-kit/app.css'
import Dashboard from './Dashboard.svelte'

export default mount(Dashboard, { target: document.getElementById('app') })
