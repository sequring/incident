import { defineConfig } from 'vite';

// Relative base so the build works both at a domain root and under /incident/ on GitHub Pages.
export default defineConfig({
  base: './',
});
