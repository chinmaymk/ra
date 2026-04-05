<script setup lang="ts">
import VersionPicker from './VersionPicker.vue'

// Always link to the root site, not the versioned build base.
const SITE_ROOT = '/ra/'
</script>

<template>
  <a class="blog-link" :href="SITE_ROOT + 'blog/'">Blog</a>
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
