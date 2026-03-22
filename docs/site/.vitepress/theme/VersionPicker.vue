<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { withBase } from 'vitepress'

declare const __DOCS_VERSION__: string

interface VersionsData {
  latest: string
  versions: string[]
}

const currentVersion = __DOCS_VERSION__
const versions = ref<VersionsData | null>(null)
const open = ref(false)

const MIN_VERSION = [0, 0, 5] as const

function meetsMinVersion(v: string): boolean {
  const parts = v.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((parts[i] || 0) > MIN_VERSION[i]) return true
    if ((parts[i] || 0) < MIN_VERSION[i]) return false
  }
  return true
}

const filteredVersions = computed(() => {
  if (!versions.value) return []
  return versions.value.versions.filter(meetsMinVersion)
})

const displayLabel = computed(() => {
  if (currentVersion === 'dev') return 'dev'
  return `v${currentVersion}`
})

function versionUrl(version: string): string {
  if (versions.value && version === versions.value.latest) return withBase('/')
  return withBase(`/v/${version}/`)
}

onMounted(async () => {
  try {
    const res = await fetch(withBase('/versions.json'))
    if (res.ok) versions.value = await res.json()
  } catch {
    // versions.json unavailable — picker shows current version only
  }
})

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}
</script>

<template>
  <div class="version-picker" @mouseleave="close">
    <button class="version-picker-button" @click="toggle" :disabled="!versions">
      {{ displayLabel }}
      <svg v-if="versions" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="version-picker-menu" v-show="open && versions">
      <a
        v-if="currentVersion !== 'dev'"
        class="version-picker-item"
        :href="withBase('/dev/')"
      >dev</a>
      <a
        v-for="v in filteredVersions"
        :key="v"
        class="version-picker-item"
        :class="{ active: v === currentVersion }"
        :href="versionUrl(v)"
      >v{{ v }}</a>
    </div>
  </div>
</template>

<style scoped>
.version-picker {
  position: relative;
  margin-left: 8px;
}

.version-picker-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
  white-space: nowrap;
  line-height: 28px;
}

.version-picker-button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}

.version-picker-button:disabled {
  cursor: default;
  opacity: 0.7;
}

.version-picker-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 100%;
  max-height: 240px;
  overflow-y: auto;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 4px;
  z-index: 100;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.version-picker-item {
  display: block;
  padding: 4px 10px;
  border-radius: 4px;
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.version-picker-item:hover {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-1);
}

.version-picker-item.active {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
</style>
