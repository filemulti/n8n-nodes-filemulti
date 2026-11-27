import { cp, rm } from 'node:fs/promises'
import path from 'node:path'

import { defineChannelConfig } from '@convertator/client'
import { build as bundle } from 'esbuild'

import manifest from './package.json' with { type: 'json' }

// WHY: a verified node ships no runtime dependency, so each file n8n loads is bundled whole with
// the shared client inside; only the host's own library stays an import. The script runs under
// Bun here and under Node in the published mirror, so it leans on neither runtime's bundler.
export async function build(
  outdir: string,
  apiUrl: string | undefined,
): Promise<void> {
  const root = import.meta.dirname
  const { apiBaseUrl } = defineChannelConfig({
    apiBaseUrl: apiUrl ?? '',
    oauthClientId: 'unused-by-n8n',
  })
  await rm(outdir, { recursive: true, force: true })
  await bundle({
    entryPoints: [...manifest.n8n.credentials, ...manifest.n8n.nodes].map(
      (file) =>
        path.join(root, file.replace(/^dist\//, '').replace(/\.js$/, '.ts')),
    ),
    outbase: root,
    outdir,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['n8n-workflow'],
    define: { __CONVERTATOR_API_URL__: JSON.stringify(apiBaseUrl) },
    logLevel: 'silent',
  })
  await cp(path.join(root, 'icons'), path.join(outdir, 'icons'), {
    recursive: true,
  })
  await cp(
    path.join(root, 'nodes/Filemulti/Filemulti.node.json'),
    path.join(outdir, 'nodes/Filemulti/Filemulti.node.json'),
  )
}

if (import.meta.main)
  await build(path.join(import.meta.dirname, 'dist'), process.argv[2])
