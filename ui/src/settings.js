import { mount } from 'svelte'
import '@dscpln/ui-kit/app.css'
import Settings from './Settings.svelte'

export default mount(Settings, { target: document.getElementById('app') })
