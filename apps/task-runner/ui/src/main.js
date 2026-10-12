import { mount } from 'svelte'
import '@dscpln/ui-kit/app.css'
import './task-runner.css'
import App from './App.svelte'

export default mount(App, { target: document.getElementById('app') })
