<script setup lang="ts">
// Always link to site root, not the versioned base
const siteRoot = '/ra/'

// Detect versioned page from URL
const versionInfo = (() => {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/\/v\/(\d+\.\d+\.\d+[^/]*)\//)
  return match ? match[1] : null
})()
</script>

<template>
  <div v-if="versionInfo" class="version-banner">
    You are viewing docs for <strong>v{{ versionInfo }}</strong>.
    <a :href="siteRoot">Switch to latest</a>
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
