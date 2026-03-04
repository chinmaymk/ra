<script setup lang="ts">
import { ref } from 'vue'
import { useData } from 'vitepress'

const { page } = useData()
const copied = ref(false)

async function copyPage() {
  const url = `https://raw.githubusercontent.com/chinmaymk/ra/main/docs/site/${page.value.relativePath}`
  try {
    const res = await fetch(url)
    const text = await res.text()
    await navigator.clipboard.writeText(text)
  } catch {
    await navigator.clipboard.writeText(window.location.href)
  }
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <button class="copy-page-btn" @click="copyPage" :title="copied ? 'Copied!' : 'Copy page as markdown'">
    <span v-if="copied">✓ Copied</span>
    <span v-else>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      Copy page
    </span>
  </button>
</template>

<style scoped>
.copy-page-btn {
  position: fixed;
  top: 72px;
  right: 24px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: inherit;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.copy-page-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
</style>
