import { mount } from 'svelte'
import '@dscpln/ui-kit/app.css'
import App from './App.svelte'

export default mount(App, { target: document.getElementById('app') })
