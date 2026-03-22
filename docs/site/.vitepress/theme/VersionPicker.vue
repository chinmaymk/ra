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

function versionUrl(version: string): string {
  if (version === 'dev') return withBase('/dev/')
  if (versions.value && version === versions.value.latest) return withBase('/')
  return withBase(`/v/${version}/`)
}

function onChange(e: Event) {
  const target = e.target as HTMLSelectElement
  const path = versionUrl(target.value)
  window.location.href = window.location.origin + path
}

onMounted(async () => {
  try {
    const res = await fetch(withBase('/versions.json'))
    if (res.ok) versions.value = await res.json()
  } catch {
    // versions.json unavailable — picker shows current version only
  }
})
</script>

<template>
  <select class="version-select" :value="currentVersion" @change="onChange">
    <option value="dev">dev</option>
    <option
      v-for="v in filteredVersions"
      :key="v"
      :value="v"
    >v{{ v }}</option>
  </select>
</template>

<style scoped>
.version-select {
  margin-left: 8px;
  padding: 2px 6px;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
  cursor: pointer;
  line-height: 28px;
  outline: none;
}

.version-select:hover,
.version-select:focus {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}
</style>
