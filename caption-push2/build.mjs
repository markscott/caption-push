import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const isWatch = process.argv.includes('--watch');

async function build() {
  const result = await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    format: 'iife',
    minify: !isWatch,
    write: false,
    target: ['chrome100', 'firefox100', 'safari15'],
    sourcemap: isWatch ? 'inline' : false,
  });

  const js = result.outputFiles[0]?.text ?? '';
  const template = readFileSync('template.html', 'utf8');
  const output = template.replace('<!-- BUNDLE -->', `<script>\n${js}\n</script>`);

  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/caption-push2.html', output);
  console.log(`[${new Date().toLocaleTimeString()}] Built dist/caption-push2.html`);
}

if (isWatch) {
  const ctx = await esbuild.context({
    entryPoints: ['src/main.ts'],
    bundle: true,
    format: 'iife',
    minify: false,
    write: false,
    target: ['chrome100', 'firefox100', 'safari15'],
    sourcemap: 'inline',
    plugins: [{
      name: 'rebuild-html',
      setup(build) {
        build.onEnd(result => {
          const js = result.outputFiles?.[0]?.text ?? '';
          const template = readFileSync('template.html', 'utf8');
          const output = template.replace('<!-- BUNDLE -->', `<script>\n${js}\n</script>`);
          mkdirSync('dist', { recursive: true });
          writeFileSync('dist/caption-push2.html', output);
          console.log(`[${new Date().toLocaleTimeString()}] Rebuilt dist/caption-push2.html`);
        });
      },
    }],
  });
  await ctx.watch();
  console.log('Watching for changes…');
} else {
  await build();
}
