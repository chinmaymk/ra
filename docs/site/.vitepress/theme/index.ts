import DefaultTheme from 'vitepress/theme'
import CopyPageButton from './CopyPageButton.vue'
import { h } from 'vue'
import './style.css'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(CopyPageButton),
    })
  },
  enhanceApp({ app }) {
    app.component('CopyPageButton', CopyPageButton)
  },
} satisfies Theme
