import DefaultTheme from 'vitepress/theme'
import CopyPageButton from './CopyPageButton.vue'
import VersionSwitcher from './VersionSwitcher.vue'
import VersionBanner from './VersionBanner.vue'
import { h } from 'vue'
import './style.css'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(CopyPageButton),
      'nav-bar-content-after': () => h(VersionSwitcher),
      'layout-top': () => h(VersionBanner),
    })
  },
  enhanceApp({ app }) {
    app.component('CopyPageButton', CopyPageButton)
    app.component('VersionSwitcher', VersionSwitcher)
    app.component('VersionBanner', VersionBanner)
  },
} satisfies Theme
