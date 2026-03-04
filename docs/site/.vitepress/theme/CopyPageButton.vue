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
  <div class="copy-page-wrapper">
    <button class="copy-page-btn" @click="copyPage" :title="copied ? 'Copied!' : 'Copy page as markdown'">
      <svg v-if="!copied" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      {{ copied ? '✓ Copied' : 'Copy page' }}
    </button>
  </div>
</template>

<style scoped>
.copy-page-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.copy-page-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.copy-page-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
</style>
