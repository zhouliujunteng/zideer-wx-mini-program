#!/usr/bin/env node
// 生成平板、电脑大屏样式（背景见 utils/screen.js 与 docs/平板与电脑大屏适配记录.md）。
//
//   node scripts/build-large-screen-styles.mjs          重新生成（改过任何 wxss 之后跑一遍）
//   node scripts/build-large-screen-styles.mjs --check  只检查是否过期，tests/large-screen-styles.test.js 用它
//
// 对 app.wxss 以及每个已注册的页面、组件的 wxss：展开其中的 @import，把用到 rpx 的样式在
// @media (min-width: 450px) 里原样再写一遍、rpx 换成固定 px，写到同目录的 <名>.large.wxss，
// 再在源 wxss 末尾 @import 它。大屏下后写的同名规则覆盖前面的，手机上这些规则不生效。
//
// 为了不打乱层叠顺序：只要某类属性（如 padding 与 padding-top 算一类）在文件里出现过 rpx，
// 这类属性的所有声明都按原顺序重写一遍，没有 rpx 的也写；其余属性不重写，保持原样。
// 固定定位的元素：left / right / width:100% 改为相对居中栏（--lg-col），全屏遮罩再加一圈同色 box-shadow 盖住两侧。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { LARGE_SCREEN_MIN_WIDTH, LARGE_SCREEN_RPX, LARGE_SCREEN_COLUMN } = require('../utils/screen.js')

const LARGE_QUERY = `(min-width: ${LARGE_SCREEN_MIN_WIDTH}px)`
const COLUMN_LEFT = 'max(0px, 50% - var(--lg-col) / 2)'
const IMPORT_NOTE = '/* 平板、电脑大屏样式：由 scripts/build-large-screen-styles.mjs 生成，改完本文件后重跑；这一行须留在文件末尾 */'

// ---------- 找出要处理的样式文件：app.wxss、已注册页面、它们用到的组件 ----------

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
}

function resolveComponent(ownerDir, ref) {
  if (!ref || /^plugin(-private)?:\/\//.test(ref)) return null
  const base = ref.startsWith('/') ? ref.slice(1) : path.posix.normalize(path.posix.join(ownerDir, ref))
  for (const candidate of [base, `${base}/index`]) {
    if (fs.existsSync(path.join(root, `${candidate}.json`))) return candidate
  }
  return null
}

function entryStyles() {
  const app = readJson('app.json')
  const pages = [
    ...app.pages,
    ...(app.subpackages || app.subPackages || []).flatMap((pkg) => pkg.pages.map((page) => `${pkg.root.replace(/\/$/, '')}/${page}`))
  ]
  const components = new Set()
  const visit = (ownerDir, using) => {
    for (const ref of Object.values(using || {})) {
      const component = resolveComponent(ownerDir, ref)
      if (!component || components.has(component)) continue
      components.add(component)
      visit(path.posix.dirname(component), readJson(`${component}.json`).usingComponents)
    }
  }
  visit('', app.usingComponents)
  for (const page of pages) {
    if (fs.existsSync(path.join(root, `${page}.json`))) visit(path.posix.dirname(page), readJson(`${page}.json`).usingComponents)
  }
  // 自定义底栏（custom-tab-bar）不处理：它和原生底栏一样铺满整个窗口、用 px 写死尺寸；
  // 收进居中栏要用页面上的 --lg-col，组件里读不到，底栏会缩成内容宽度（2026-09-25 实测只剩 100px）。
  return ['app', ...pages, ...components]
    .map((name) => `${name}.wxss`)
    .filter((file, index, all) => all.indexOf(file) === index && fs.existsSync(path.join(root, file)))
}

// ---------- 极简 CSS 解析（WXSS 只用到普通规则、@import、@media、@keyframes） ----------

function stripComments(css) {
  let out = ''
  let quote = ''
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]
    if (quote) {
      out += ch
      if (ch === '\\') { out += css[i + 1] || ''; i += 1 } else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
      out += ch
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? css.length : end + 1
    } else {
      out += ch
    }
  }
  return out
}

// 从 start 起找第一个不在引号、括号里的 stops 字符。
function scan(css, start, stops) {
  let quote = ''
  let parens = 0
  for (let i = start; i < css.length; i += 1) {
    const ch = css[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') parens += 1
    else if (ch === ')') parens = Math.max(0, parens - 1)
    else if (!parens && stops.includes(ch)) return i
  }
  return -1
}

function matchingBrace(css, open) {
  let depth = 0
  let quote = ''
  for (let i = open; i < css.length; i += 1) {
    const ch = css[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (!depth) return i
    }
  }
  throw new Error('大括号不配对')
}

function parseDeclarations(body) {
  const decls = []
  let start = 0
  while (start < body.length) {
    const end = scan(body, start, ';')
    const text = body.slice(start, end < 0 ? body.length : end).trim()
    start = end < 0 ? body.length : end + 1
    const colon = scan(text, 0, ':')
    if (colon > 0) decls.push({ prop: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() })
  }
  return decls
}

function parseStatements(css) {
  const nodes = []
  let pos = 0
  while (pos < css.length) {
    const stop = scan(css, pos, ';{}')
    if (stop < 0) break
    const prelude = css.slice(pos, stop).trim().replace(/\s+/g, ' ')
    if (css[stop] === '}') { pos = stop + 1; continue }
    if (css[stop] === ';') {
      const found = /^@import\s+(?:url\()?\s*["']([^"']+)["']/.exec(prelude)
      if (found) nodes.push({ type: 'import', path: found[1] })
      pos = stop + 1
      continue
    }
    const close = matchingBrace(css, stop)
    const body = css.slice(stop + 1, close)
    if (/^@media\b/.test(prelude)) nodes.push({ type: 'media', query: prelude.replace(/^@media\s*/, ''), children: parseStatements(body) })
    else if (/^@(-webkit-)?keyframes\b/.test(prelude)) nodes.push({ type: 'keyframes', prelude, frames: parseStatements(body) })
    else if (!prelude.startsWith('@')) nodes.push({ type: 'rule', selector: prelude, decls: parseDeclarations(body) })
    pos = close + 1
  }
  return nodes
}

// ---------- 展开 @import（与 wcsc 一致：同一文件只引入一次） ----------

function managedImportPattern(file) {
  const base = path.basename(file, '.wxss').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`[ \\t]*@import\\s+["']\\./${base}\\.large\\.wxss["'];[^\\n]*\\n?`, 'g')
}

function stripManagedImport(file, css) {
  return css.replace(managedImportPattern(file), '')
}

function flatten(file, seen) {
  if (seen.has(file)) return []
  seen.add(file)
  const css = stripManagedImport(file, fs.readFileSync(path.join(root, file), 'utf8'))
  return parseStatements(stripComments(css)).flatMap((node) => {
    if (node.type !== 'import') return [node]
    const target = node.path.startsWith('/')
      ? node.path.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(file), node.path))
    const withExt = target.endsWith('.wxss') ? target : `${target}.wxss`
    if (!fs.existsSync(path.join(root, withExt))) throw new Error(`${file} 引入的 ${node.path} 不存在`)
    return flatten(withExt, seen)
  })
}

// ---------- 换算 ----------

const RPX = /(^|[^\w.-])(-?(?:\d+\.?\d*|\.\d+))rpx\b/g

export function rpxToPx(number) {
  // 与基础库的 transformRPX 相同：向下取整，非零却取整成 0 的记作 0.5px（发丝线）。
  const px = Math.floor(number * LARGE_SCREEN_RPX + 1e-4)
  return px === 0 && number !== 0 ? 0.5 : px
}

// 引号和 url() 里的内容不换算（wcsc 也不换算）。
function mapOutsideLiterals(value, fn) {
  let out = ''
  let plain = ''
  for (let i = 0; i < value.length;) {
    const ch = value[i]
    let end = -1
    if (ch === '"' || ch === "'") {
      end = i + 1
      while (end < value.length && value[end] !== ch) end += value[end] === '\\' ? 2 : 1
    } else if (/^url\(/i.test(value.slice(i, i + 4))) {
      end = value.indexOf(')', i)
    }
    if (end < 0) { plain += ch; i += 1; continue }
    out += fn(plain) + value.slice(i, end + 1)
    plain = ''
    i = end + 1
  }
  return out + fn(plain)
}

function hasRpx(value) {
  let found = false
  mapOutsideLiterals(value, (text) => { if (new RegExp(RPX.source).test(text)) found = true; return text })
  return found
}

export function convert(value) {
  return mapOutsideLiterals(value, (text) => text.replace(RPX, (_, lead, number) => `${lead}${rpxToPx(Number(number))}px`))
}

// 会互相覆盖的属性算同一类：简写与分写（padding / padding-top）、font 与 line-height、
// top/left 与 inset、各种 gap、width 与 inline-size 等。归类宁宽勿窄，多写不出错。
const FAMILY_ALIASES = {
  line: 'font',
  top: 'inset', right: 'inset', bottom: 'inset', left: 'inset',
  row: 'gap', column: 'gap', columns: 'gap', grid: 'gap',
  width: 'size', height: 'size', min: 'size', max: 'size', inline: 'size', block: 'size'
}

function family(prop) {
  const name = prop.trim().toLowerCase()
  if (name.startsWith('--')) return name
  const head = name.replace(/^-(webkit|moz|ms|o)-/, '').split('-')[0]
  return FAMILY_ALIASES[head] || head
}

// ---------- 固定定位元素收进居中栏 ----------

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+)(px|rpx)?|0)$/

function lastValue(decls, prop) {
  const found = decls.filter((decl) => decl.prop.toLowerCase() === prop)
  return found.length ? found[found.length - 1].value.replace(/\s*!important\s*$/i, '').trim() : null
}

function expandInset(decls) {
  return decls.flatMap((decl) => {
    if (decl.prop.toLowerCase() !== 'inset') return [decl]
    const parts = decl.value.split(/\s+/)
    const [top, right = top, bottom = top, left = right] = parts
    return [
      { prop: 'top', value: top },
      { prop: 'right', value: right },
      { prop: 'bottom', value: bottom },
      { prop: 'left', value: left }
    ]
  })
}

function columnOffset(value) {
  const length = convert(value)
  return /^-?0(px)?$/.test(length) ? COLUMN_LEFT : `calc(${COLUMN_LEFT} + ${length})`
}

const PLAIN_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\)|[a-z]+)$/i

function pinToColumn(decls) {
  if (lastValue(decls, 'position') !== 'fixed') return null
  const expanded = expandInset(decls)
  let touched = false
  const pinned = expanded.map((decl) => {
    const prop = decl.prop.toLowerCase()
    const value = decl.value.trim()
    if ((prop === 'left' || prop === 'right') && LENGTH.test(value)) {
      touched = true
      return { prop: decl.prop, value: columnOffset(value) }
    }
    if (prop === 'width' && /^(100%|100vw)$/.test(value)) {
      touched = true
      return { prop: decl.prop, value: 'min(100%, var(--lg-col))' }
    }
    return decl
  })
  if (!touched) return null
  // 全屏遮罩（上下左右贴边、纯色底）：遮罩本身收进栏里，两侧用同色 box-shadow 盖住。
  const top = lastValue(expanded, 'top')
  const bottom = lastValue(expanded, 'bottom')
  const height = lastValue(expanded, 'height')
  const left = lastValue(expanded, 'left')
  const right = lastValue(expanded, 'right')
  const width = lastValue(expanded, 'width')
  const fullScreen = /^0(px|rpx)?$/.test(top || '') && (/^0(px|rpx)?$/.test(bottom || '') || /^100(%|vh)$/.test(height || ''))
    && /^0(px|rpx)?$/.test(left || '') && (/^0(px|rpx)?$/.test(right || '') || /^100(%|vw)$/.test(width || ''))
  const background = lastValue(expanded, 'background-color') || lastValue(expanded, 'background')
  if (fullScreen && background && PLAIN_COLOR.test(background) && !/^(transparent|none|inherit|initial)$/i.test(background) && !lastValue(expanded, 'box-shadow')) {
    pinned.push({ prop: 'box-shadow', value: `0 0 0 100vmax ${background}` })
  }
  return pinned
}

// ---------- 生成 ----------

function combineQuery(query) {
  const parts = query.split(',').map((part) => part.trim()).filter(Boolean)
  const alwaysNever = parts.every((part) => {
    const max = /^\(\s*max-width\s*:\s*([\d.]+)px\s*\)$/.exec(part)
    return max && Number(max[1]) < LARGE_SCREEN_MIN_WIDTH
  })
  if (alwaysNever) return null
  return parts.map((part) => {
    const min = /^\(\s*min-width\s*:\s*([\d.]+)px\s*\)$/.exec(part)
    if (min && Number(min[1]) <= LARGE_SCREEN_MIN_WIDTH) return LARGE_QUERY
    const typed = /^(only\s+)?(screen|all)\s+and\s+(.*)$/i.exec(part)
    return typed ? `${typed[1] || ''}${typed[2]} and ${LARGE_QUERY} and ${typed[3]}` : `${LARGE_QUERY} and ${part}`
  }).join(', ')
}

function collectRules(nodes, query, out) {
  for (const node of nodes) {
    if (node.type === 'rule') out.push({ query, node })
    else if (node.type === 'keyframes') out.push({ query, node })
    else if (node.type === 'media') {
      const combined = combineQuery(node.query)
      if (combined) collectRules(node.children, query === LARGE_QUERY ? combined : `${query} and ${node.query}`, out)
    }
  }
  return out
}

// nodes：展开 @import 后的语句列表。返回大屏样式正文（不含文件头），没有需要重写的内容时返回 ''。
export function largeStylesFromNodes(nodes, { app = false } = {}) {
  const items = collectRules(nodes, LARGE_QUERY, [])
  const families = new Set()
  const pinnedRules = new Map()
  for (const { node } of items) {
    if (node.type !== 'rule') continue
    for (const decl of node.decls) if (hasRpx(decl.value)) families.add(family(decl.prop))
    const pinned = pinToColumn(node.decls)
    if (pinned) {
      pinnedRules.set(node, pinned)
      families.add('inset')
      families.add('size')
      if (pinned.some((decl) => decl.prop === 'box-shadow')) families.add('box')
    }
  }

  const chunks = []
  const push = (query, text) => {
    const last = chunks[chunks.length - 1]
    if (last && last.query === query) last.lines.push(text)
    else chunks.push({ query, lines: [text] })
  }
  for (const { query, node } of items) {
    if (node.type === 'keyframes') {
      if (!node.frames.some((frame) => frame.decls && frame.decls.some((decl) => hasRpx(decl.value)))) continue
      const frames = node.frames.map((frame) => `${frame.selector}{${frame.decls.map((d) => `${d.prop}:${convert(d.value)}`).join(';')}}`)
      push(query, `${node.prelude}{${frames.join('')}}`)
      continue
    }
    const decls = (pinnedRules.get(node) || node.decls).filter((decl) => families.has(family(decl.prop)))
    if (decls.length) push(query, `${node.selector}{${decls.map((d) => `${d.prop}:${convert(d.value)}`).join(';')}}`)
  }

  if (app) {
    chunks.unshift({
      query: LARGE_QUERY,
      lines: [`page{--lg-col:${LARGE_SCREEN_COLUMN}px;max-width:var(--lg-col);margin-left:auto;margin-right:auto}`]
    })
  }
  return chunks.map((chunk) => `@media ${chunk.query} {\n${chunk.lines.join('\n')}\n}\n`).join('')
}

export function largeStylesFromCss(css, options) {
  return largeStylesFromNodes(parseStatements(stripComments(css)), options)
}

function buildLargeStyles(file) {
  const body = largeStylesFromNodes(flatten(file, new Set()), { app: file === 'app.wxss' })
  if (!body) return null
  const header = `/* 自动生成，请勿手改：${path.basename(file)} 在平板、电脑大屏（窗口宽 ≥ ${LARGE_SCREEN_MIN_WIDTH}px）下的样式。\n`
    + `   rpx 按 1rpx = ${LARGE_SCREEN_RPX}px 换算，固定定位元素收进居中栏；改完源文件后运行 node scripts/build-large-screen-styles.mjs */\n`
  return header + body
}

function largeFileOf(file) {
  return file.replace(/\.wxss$/, '.large.wxss')
}

// 已经以这行结尾（或本来就不需要）的源文件原样保留，不动别处的空白。
function sourceWithImport(file, css, needed) {
  const line = `@import "./${path.basename(largeFileOf(file))}"; ${IMPORT_NOTE}`
  const stripped = stripManagedImport(file, css)
  if (!needed) return stripped === css ? css : `${stripped.replace(/\s+$/, '')}\n`
  const occurrences = css.length - stripped.length > 0 ? (css.match(managedImportPattern(file)) || []).length : 0
  if (occurrences === 1 && css.replace(/\s+$/, '').endsWith(line)) return css
  return `${stripped.replace(/\s+$/, '')}\n\n${line}\n`
}

function listLargeFiles(dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'tests', 'scripts'].includes(entry.name) || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listLargeFiles(full, out)
    else if (entry.name.endsWith('.large.wxss')) out.push(path.relative(root, full).split(path.sep).join('/'))
  }
  return out
}

function plan() {
  const writes = new Map()
  const entries = entryStyles()
  for (const file of entries) {
    const large = buildLargeStyles(file)
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    writes.set(file, sourceWithImport(file, source, Boolean(large)))
    if (large) writes.set(largeFileOf(file), large)
  }
  const removes = listLargeFiles().filter((file) => !writes.has(file))
  return { writes, removes }
}

// 写入顺序：先写 .large.wxss，停一会儿再改源 wxss，最后删多余文件。
// 开发者工具开着项目时按文件事件增量做依赖分析，预览、上传时据此过滤「无依赖文件」。
// 源 wxss 先出现 @import 而 .large.wxss 还没写到盘上，这次分析就把它记成缺失、之后不再补查，
// 预览时报「path ./index.large.wxss not found」（2026-09-24 一次新建 86 个文件时踩过）。
const SETTLE_MS = 1500

function readOrNull(file) {
  const full = path.join(root, file)
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
}

async function main() {
  const check = process.argv.includes('--check')
  const { writes, removes } = plan()
  const pending = [...writes].filter(([file, content]) => readOrNull(file) !== content)
  const larges = pending.filter(([file]) => file.endsWith('.large.wxss'))
  const sources = pending.filter(([file]) => !file.endsWith('.large.wxss'))
  const stale = pending.map(([file]) => file).concat(removes.map((file) => `${file}（多余，应删除）`))
  if (check) {
    if (stale.length) {
      console.error(`大屏样式已过期，请运行 node scripts/build-large-screen-styles.mjs：\n${stale.join('\n')}`)
      process.exit(1)
    }
    console.log('大屏样式是最新的')
    return
  }
  const created = larges.some(([file]) => readOrNull(file) === null)
  for (const [file, content] of larges) fs.writeFileSync(path.join(root, file), content)
  if (created && sources.length) await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  for (const [file, content] of sources) fs.writeFileSync(path.join(root, file), content)
  for (const file of removes) fs.unlinkSync(path.join(root, file))
  console.log(stale.length ? `已更新 ${stale.length} 个文件` : '无需更新')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1) })
}
