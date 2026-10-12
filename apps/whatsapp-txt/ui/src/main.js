import { mount } from 'svelte'
import '@dscpln/ui-kit/app.css'
import './whatsapp.css'
import App from './App.svelte'

export default mount(App, { target: document.getElementById('app') })
