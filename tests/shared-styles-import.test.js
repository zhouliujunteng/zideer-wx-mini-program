// 公共卡片、状态面板和主题色变量只定义在 styles/account-form.wxss，app.wxss 里没有。
// 用到它们的页面必须自己引入，否则线上直接没有样式（2026-09-23 查出约 30 个页面一直缺）。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const shared = fs.readFileSync(path.join(root, 'styles/account-form.wxss'), 'utf8')
const sharedVars = new Set([...shared.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
const sharedClasses = new Set(['surface', 'skeleton', 'state-panel', 'state-panel__action', 'state-panel__copy', 'state-panel__mark', 'state-panel__title'])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'tests', 'scripts'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name === 'index.wxml') out.push(path.dirname(full))
  }
  return out
}

function importsShared(dir, wxss) {
  return [...wxss.matchAll(/@import "([^"]+)"/g)].some((m) => {
    const file = path.normalize(path.join(dir, m[1]))
    return m[1].includes('account-form') || (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('account-form'))
  })
}

test('pages using shared card, state panel or theme variables import styles/account-form.wxss', () => {
  const missing = []
  for (const dir of walk(root)) {
    if (dir.includes(`${path.sep}components${path.sep}`)) continue
    const wxml = fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8')
    const wxssFile = path.join(dir, 'index.wxss')
    const wxss = fs.existsSync(wxssFile) ? fs.readFileSync(wxssFile, 'utf8') : ''
    const tokens = new Set()
    for (const m of wxml.matchAll(/class="([^"]*)"/g)) {
      m[1].replace(/\{\{[^}]*\}\}/g, (expr) => { expr.replace(/'([\w -]+)'/g, (_, words) => words.split(/\s+/).forEach((w) => tokens.add(w))); return ' ' })
        .split(/\s+/).forEach((w) => tokens.add(w))
    }
    const used = [...tokens].filter((t) => sharedClasses.has(t))
      .concat([...new Set([...(wxss + wxml).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))]
        .filter((v) => sharedVars.has(v) && !new RegExp(`${v}\\s*:`).test(wxss)))
    if (used.length && !importsShared(dir, wxss)) missing.push(`${path.relative(root, dir)}: ${used.join(' ')}`)
  }
  assert.deepEqual(missing, [])
})

test('theme variables referenced anywhere are defined somewhere', () => {
  const defined = new Set(sharedVars)
  const referenced = new Map()
  const files = []
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'tests'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) collect(full)
      else if (/\.(wxss|wxml)$/.test(entry.name)) files.push(full)
    }
  }
  collect(root)
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1])
    for (const m of text.matchAll(/var\((--[\w-]+)\s*\)/g)) referenced.set(m[1], path.relative(root, file))
  }
  const undefinedVars = [...referenced].filter(([name]) => !defined.has(name)).map(([name, file]) => `${name} (${file})`)
  assert.deepEqual(undefinedVars, [])
})

test('growth-page lets the host page styles apply inside the component', () => {
  assert.match(fs.readFileSync(path.join(root, 'components/growth-page/index.js'), 'utf8'), /styleIsolation: 'apply-shared'/)
})
