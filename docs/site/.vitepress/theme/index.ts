import DefaultTheme from 'vitepress/theme'
import CopyPageButton from './CopyPageButton.vue'
import VersionPicker from './VersionPicker.vue'
import { h } from 'vue'
import './style.css'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(CopyPageButton),
      'nav-bar-content-after': () => h(VersionPicker),
    })
  },
  enhanceApp({ app }) {
    app.component('CopyPageButton', CopyPageButton)
  },
} satisfies Theme
