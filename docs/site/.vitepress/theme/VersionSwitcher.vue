<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'

interface VersionsData {
  latest: string
  versions: string[]
}

const data = ref<VersionsData | null>(null)
const open = ref(false)
const currentView = ref<string | null>(null)
const btnRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const dropdownStyle = ref<Record<string, string>>({})

const siteRoot = '/ra/'

function onClickOutside(e: MouseEvent) {
  const target = e.target as Node
  if (btnRef.value?.contains(target) || dropdownRef.value?.contains(target)) return
  open.value = false
}

onMounted(async () => {
  document.addEventListener('click', onClickOutside)

  if (window.location.pathname.startsWith('/ra/dev/')) {
    currentView.value = 'dev'
  } else {
    const match = window.location.pathname.match(/\/v\/(\d+\.\d+\.\d+[^/]*)\//)
    currentView.value = match ? match[1] : null
  }

  try {
    const res = await fetch(`${siteRoot}versions.json`)
    if (res.ok) {
      data.value = await res.json()
    }
  } catch {
    // versions.json not available
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
})

const displayLabel = computed(() => {
  if (currentView.value === 'dev') return 'dev'
  if (currentView.value) return `v${currentView.value}`
  return data.value ? `v${data.value.latest}` : ''
})

function versionUrl(version: string) {
  if (version === 'dev') return `${siteRoot}dev/`
  return `${siteRoot}v/${version}/`
}

function isActive(v: string) {
  return currentView.value === v || (!currentView.value && v === data.value?.latest)
}

function navigateTo(url: string) {
  // Full page navigation — each version is a separate VitePress build
  // so we can't use the SPA router
  window.location.assign(url)
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    positionDropdown()
  }
}

function positionDropdown() {
  if (!btnRef.value) return
  const rect = btnRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    right: `${window.innerWidth - rect.right}px`,
  }
}
</script>

<template>
  <div v-if="data && data.versions.length > 0" class="version-switcher">
    <button ref="btnRef" class="version-btn" @click="toggle">
      {{ displayLabel }}
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>
    <Teleport to="body">
      <div v-show="open" ref="dropdownRef" class="version-dropdown" :style="dropdownStyle">
        <a
          :href="versionUrl('dev')"
          class="version-item"
          :class="{ active: currentView === 'dev' }"
          @click.prevent.stop="navigateTo(versionUrl('dev'))"
        >
          dev
        </a>
        <a
          v-for="v in data.versions"
          :key="v"
          :href="v === data.latest ? siteRoot : versionUrl(v)"
          class="version-item"
          :class="{ active: isActive(v) }"
          @click.prevent.stop="navigateTo(v === data.latest ? siteRoot : versionUrl(v))"
        >
          v{{ v }}
          <span v-if="v === data.latest" class="latest-badge">latest</span>
        </a>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.version-switcher {
  position: relative;
  display: flex;
  align-items: center;
  margin-left: 8px;
}

.version-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 12px;
  line-height: 1;
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
  white-space: nowrap;
}

.version-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
</style>

<style>
/* Dropdown is teleported to body, so styles must be global */
.version-dropdown {
  min-width: 140px;
  padding: 4px;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 100;
}

.version-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
  text-decoration: none;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}

.version-item:hover {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.version-item.active {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.latest-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
</style>
