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
  // learning/agent-invite：两个按钮的图标都按状态写在三元表达式里（未做 / 已做成对勾），扫描器认不出来
  'live-meeting/bell.svg',
  'live-meeting/check-orange.svg',
  'live-meeting/calendar-add.svg',
  'live-meeting/check-blue.svg',
  // pages/home：/assets/home/score-tools/{{item.id}}.png
  ...['question-review', 'error-diagnosis', 'solution-steps', 'scoring-points', 'intuition-training', 'error-variation', 'paper-analysis']
    .map((id) => `home/score-tools/${id}.png`),
  // pages/profile-setup、services/mock-service：textbook-covers/${版本}-${学科}.jpg
  ...['pep', 'beishi', 'sujiao', 'zhejiang', 'other', 'unified']
    .flatMap((edition) => ['english', 'language', 'math'].map((subject) => `profile-setup/textbook-covers/${edition}-${subject}.jpg`)),
  // utils/ui-asset.wxs 的 UA.avatar：用户未授权头像时的默认头像
  'avatar/default.png',
  // services/checkin-model：学习连胜页道具卡图标 /learning/assets/check-in/card-${type}.svg
  'check-in/card-freeze.svg',
  'check-in/card-revive.svg',
  // account/help-center/content.js guideIconPath：help/guide-${指南id}.png；account/help-guide 画分享封面用的底图
  ...['start-course', 'daily-task', 'checkin', 'redeem-code', 'coin-cash', 'bind-student', 'switch-role', 'assessment', 'invite', 'membership', 'feedback']
    .map((id) => `help/guide-${id}.png`),
  'help/share-cover.jpg'
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

// 底栏图标（assets/tabbar/*.png）是包内文件：app.json tabBar 声明的图标平台只认本地，自定义底栏也直接用它们
const PACKAGE_ONLY = /^tabbar\//

const referenced = new Map()
for (const file of walk(ROOT)) {
  for (const match of readFileSync(file, 'utf8').matchAll(/assets\/([A-Za-z0-9_/.-]+\.(?:png|svg|jpe?g|gif|webp))/g)) {
    if (!PACKAGE_ONLY.test(match[1]) && !referenced.has(match[1])) referenced.set(match[1], relative(ROOT, file))
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
