<script setup lang="ts">
import { ref, onMounted } from 'vue'

// Always link to site root, not the versioned base
const siteRoot = '/ra/'

const pageInfo = ref<{ type: 'dev' } | { type: 'version'; version: string } | null>(null)

onMounted(() => {
  if (window.location.pathname.startsWith('/ra/dev/')) {
    pageInfo.value = { type: 'dev' }
  } else {
    const match = window.location.pathname.match(/\/v\/(\d+\.\d+\.\d+[^/]*)\//)
    pageInfo.value = match ? { type: 'version', version: match[1] } : null
  }
})
</script>

<template>
  <div v-if="pageInfo?.type === 'dev'" class="version-banner dev-banner">
    You are viewing <strong>development</strong> docs from the main branch.
    <a :href="siteRoot">Switch to latest release</a>
  </div>
  <div v-else-if="pageInfo?.type === 'version'" class="version-banner">
    You are viewing docs for <strong>v{{ (pageInfo as { type: 'version'; version: string }).version }}</strong>.
    <a :href="siteRoot">Switch to latest release</a>
  </div>
</template>

<style scoped>
.version-banner {
  padding: 10px 16px;
  font-size: 14px;
  text-align: center;
  color: var(--vp-c-warning-1);
  background: var(--vp-c-warning-soft);
  border-bottom: 1px solid var(--vp-c-warning-1);
}

.version-banner a {
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: underline;
}
</style>
