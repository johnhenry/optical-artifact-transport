import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [
      ['packages/sender/**', 'happy-dom'],
      ['packages/receiver/**', 'happy-dom'],
      ['packages/ui/**', 'happy-dom']
    ]
  }
});
