// WXS 只认一个 ES5 子集，写错了开发者工具报「编译 .wxml 文件错误」、整个小程序白屏；
// 而各页面测试用 node vm 跑 .wxs，Node 能执行的写法都能过，发现不了（2026-09-29 question-figure.wxs 踩过）。
// 用开发者工具自带的 wcc 实测（2026-09-29）：
// - `Number(...)`、`Date(...)` 出现在 var 初始化、三元表达式里就报 Unexpected token `(`，`return Number(x)` 却能过，
//   所以一律不写：数字用 parseFloat / parseInt，日期用 getDate()；
// - 箭头函数、模板字符串直接报错。String()、Boolean()、parseInt()、Math.*、getRegExp() 等没问题。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const WCC = process.env.WCC || '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcc'

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'tests'].includes(entry.name) || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.wxs')) out.push(full)
  }
  return out
}

// 去掉注释（保留换行以便报行号），字符串里的 // 不当注释
function stripComments(source) {
  let out = ''
  let quote = ''
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      out += c
      if (c === '\\') out += source[++i] || ''
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
      out += c
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end < 0 ? source.length : end + 2
      out += source.slice(i, stop).replace(/[^\n]/g, '')
      i = stop - 1
    } else {
      out += c
    }
  }
  return out
}

const RULES = [
  [/\b(Number|Date)\s*\(/, 'Number()/Date() 不能调用：用 parseFloat / parseInt、getDate()'],
  [/=>/, '不支持箭头函数'],
  [/`/, '不支持模板字符串']
]

const files = walk(root)

test('there are wxs files to check', () => {
  assert.ok(files.some((file) => file.endsWith(path.join('utils', 'question-figure.wxs'))))
  assert.ok(files.some((file) => file.endsWith(path.join('utils', 'ui-asset.wxs'))))
})

test('wxs files avoid syntax the WXS compiler rejects', () => {
  const problems = []
  for (const file of files) {
    stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
      for (const [pattern, reason] of RULES) {
        if (pattern.test(line)) problems.push(`${path.relative(root, file)}:${index + 1} ${reason}`)
      }
    })
  }
  assert.deepEqual(problems, [])
})

test('comment stripping keeps urls in strings and drops comments', () => {
  assert.equal(stripComments("var a = 'https://x' // Number(1)\n/* Date(\n) */b"), "var a = 'https://x' \n\nb")
})

// 本机装了微信开发者工具时，再用它自带的 wcc 真编译一遍（没装就跳过）
function compile(dir, wxs) {
  fs.writeFileSync(path.join(dir, 't.wxs'), wxs)
  fs.writeFileSync(path.join(dir, 'a.wxml'), '<wxs module="m" src="./t.wxs" />\n<view></view>\n')
  const result = spawnSync(WCC, ['-d', 'a.wxml', 't.wxs'], { cwd: dir, encoding: 'utf8', timeout: 20000 })
  return { ok: result.status === 0, message: (result.stderr || result.stdout || '').trim().slice(0, 300) }
}

test('wxs files compile with the devtools wcc', { skip: !fs.existsSync(WCC) && `未找到 wcc：${WCC}` }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxs-compat-'))
  try {
    // 先确认 wcc 真会拒绝已知的坏写法，免得调用方式变了以后这条测试永远通过
    assert.equal(compile(dir, 'function f(x) { var w = Number(x)\n  return w }\nmodule.exports = { f: f }\n').ok, false)
    const failures = files
      .map((file) => ({ file, ...compile(dir, fs.readFileSync(file, 'utf8')) }))
      .filter((result) => !result.ok)
      .map((result) => `${path.relative(root, result.file)}: ${result.message}`)
    assert.deepEqual(failures, [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
