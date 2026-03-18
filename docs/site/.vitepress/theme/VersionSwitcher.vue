<script setup lang="ts">
import { ref, onMounted } from 'vue'

const versions = ref<string[]>([])
const open = ref(false)

// Always resolve relative to the site root, not the versioned base
const siteRoot = '/ra/'

onMounted(async () => {
  try {
    const res = await fetch(`${siteRoot}versions.json`)
    if (res.ok) {
      versions.value = await res.json()
    }
  } catch {
    // versions.json not available — no versions to show
  }
})

// Detect if we're viewing a versioned page
const currentVersion = (() => {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/\/v\/(\d+\.\d+\.\d+[^/]*)\//)
  return match ? match[1] : null
})()

const label = currentVersion || 'latest'

function versionUrl(version: string | null) {
  if (!version) return siteRoot
  return `${siteRoot}v/${version}/`
}

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}
</script>

<template>
  <div v-if="versions.length > 0" class="version-switcher" @mouseleave="close">
    <button class="version-btn" @click="toggle">
      {{ label }}
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>
    <div v-show="open" class="version-dropdown">
      <a
        :href="versionUrl(null)"
        class="version-item"
        :class="{ active: !currentVersion }"
        @click="close"
      >
        latest
      </a>
      <a
        v-for="v in versions"
        :key="v"
        :href="versionUrl(v)"
        class="version-item"
        :class="{ active: currentVersion === v }"
        @click="close"
      >
        v{{ v }}
      </a>
    </div>
  </div>
</template>

<style scoped>
.version-switcher {
  position: relative;
  margin-left: 8px;
}

.version-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}

.version-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.version-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 120px;
  padding: 4px;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 100;
}

.version-item {
  display: block;
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
</style>
