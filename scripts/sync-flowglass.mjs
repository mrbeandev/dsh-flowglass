import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'dist/toolbox-bundles/flowglass-en')
const target = resolve(root, 'flowglass')

if (!existsSync(source)) throw new Error('Build output is missing: ' + source)
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const entry of readdirSync(source)) cpSync(resolve(source, entry), resolve(target, entry), { recursive: true })
console.log('Synchronized Flowglass package into flowglass/')
