<script setup lang="ts">
import { useData } from 'vitepress'
import VersionPicker from './VersionPicker.vue'

const { site } = useData()
</script>

<template>
  <a class="blog-link" :href="site.base + 'blog/'">Blog</a>
  <VersionPicker />
</template>

<style scoped>
.blog-link {
  margin-right: 8px;
  padding: 2px 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  text-decoration: none;
  line-height: 28px;
}

.blog-link:hover {
  color: var(--vp-c-brand-1);
}
</style>
