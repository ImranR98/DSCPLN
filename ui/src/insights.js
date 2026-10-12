import { mount } from 'svelte'
import '@dscpln/ui-kit/app.css'
import './balance.css'
import Insights from './Insights.svelte'

export default mount(Insights, { target: document.getElementById('app') })
