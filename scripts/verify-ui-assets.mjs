#!/usr/bin/env node
// 检查代码里引用的每个界面素材在后端 ui_asset 表都已上架（以游客身份读取，与小程序一致）。
// 用法：node scripts/verify-ui-assets.mjs
// 素材键 = 路径中 "assets/" 之后的部分；按变量拼接的路径在 DYNAMIC_KEYS 里显式列出，新增时同步维护。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PROJECT_ID = /PROJECT_ID\s*=\s*['"]([^'"]+)/.exec(readFileSync(join(ROOT, 'config/index.js'), 'utf8'))[1]
const SKIP = new Set(['node_modules', 'tests', 'scripts', 'docs', 'integrations'])

const DYNAMIC_KEYS = [
  // pages/home：/assets/home/score-tools/{{item.id}}.png
  ...['question-review', 'error-diagnosis', 'solution-steps', 'scoring-points', 'intuition-training', 'error-variation', 'paper-analysis']
    .map((id) => `home/score-tools/${id}.png`),
  // pages/profile-setup、services/mock-service：textbook-covers/${版本}-${学科}.jpg
  ...['pep', 'beishi', 'sujiao', 'zhejiang', 'other', 'unified']
    .flatMap((edition) => ['english', 'language', 'math'].map((subject) => `profile-setup/textbook-covers/${edition}-${subject}.jpg`)),
  // custom-tab-bar：/assets/icons/{{item.icon}}{{-active}}.svg
  ...['home', 'book', 'network', 'user'].flatMap((icon) => [`icons/${icon}.svg`, `icons/${icon}-active.svg`])
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(wxml|js|wxss)$/.test(name)) out.push(full)
  }
  return out
}

const referenced = new Map()
for (const file of walk(ROOT)) {
  for (const match of readFileSync(file, 'utf8').matchAll(/assets\/([A-Za-z0-9_/.-]+\.(?:png|svg|jpe?g|gif|webp))/g)) {
    if (!referenced.has(match[1])) referenced.set(match[1], relative(ROOT, file))
  }
}
for (const key of DYNAMIC_KEYS) if (!referenced.has(key)) referenced.set(key, '(dynamic)')

const response = await fetch(`https://zion-app.functorz.com/zero/${PROJECT_ID}/api/graphql-v2`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'query { ui_asset(where: {enabled: {_eq: true}}) { asset_key image { url } } }' })
})
const body = await response.json()
if (!body.data || !Array.isArray(body.data.ui_asset)) {
  console.error('无法读取 ui_asset：', JSON.stringify(body.errors || body).slice(0, 300))
  process.exit(2)
}
const available = new Set(body.data.ui_asset.filter((row) => row.image && row.image.url).map((row) => row.asset_key))
const missing = [...referenced].filter(([key]) => !available.has(key))

console.log(`代码引用 ${referenced.size} 个素材，后端已上架 ${available.size} 个。`)
if (missing.length) {
  console.error(`缺少 ${missing.length} 个：`)
  for (const [key, file] of missing) console.error(`  ${key}   ← ${file}`)
  process.exit(1)
}
console.log('全部素材已上架。')
