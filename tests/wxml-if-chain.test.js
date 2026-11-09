const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 2026-09-22 踩过：诊断室里「只显示卡片、老师的文字一条都不出来」。
// 原因是 pages/diagnosis-room/index.wxml 的条件分支链里，两个兄弟节点之间夹了一行注释。
// 微信编译 WXML 时注释会切断这条链：注释之前的分支照常渲染，注释之后的分支
// （含最后兜底的文字气泡）全部变成孤立分支，永远不渲染。
// 说明要写就写在元素内部。

const root = path.join(__dirname, '..')

function listTemplates(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listTemplates(full)
    return entry.name.endsWith('.wxml') ? [full] : []
  })
}

// 注释块之后的第一个标签：带 wx:elif / wx:else 就说明这条链被切断了
function danglingBranches(source) {
  const found = []
  const comment = /<!--[\s\S]*?-->/g
  let match
  while ((match = comment.exec(source)) !== null) {
    const after = source.slice(match.index + match[0].length)
    const tag = /^\s*<([^>]*)>/.exec(after)
    if (!tag) continue
    if (/\bwx:elif\b|\bwx:else\b/.test(tag[1])) {
      found.push(tag[1].slice(0, 60).replace(/\s+/g, ' '))
    }
  }
  return found
}

test('no WXML comment sits between branches of a condition chain', () => {
  const offenders = []
  for (const file of listTemplates(root)) {
    const dangling = danglingBranches(fs.readFileSync(file, 'utf8'))
    for (const tag of dangling) offenders.push(`${path.relative(root, file)} → <${tag}>`)
  }
  assert.deepEqual(offenders, [], '注释要写在元素内部，写在分支之间会让它后面的分支不渲染')
})

test('the checker actually catches the shape that broke the room', () => {
  const broken = `<view wx:if="{{a}}">A</view>\n<!-- 说明 -->\n<view wx:elif="{{b}}">B</view>\n<view wx:else>C</view>`
  assert.equal(danglingBranches(broken).length, 1)
  const fixed = `<view wx:if="{{a}}">A</view>\n<view wx:elif="{{b}}"><!-- 说明 -->B</view>\n<view wx:else>C</view>`
  assert.deepEqual(danglingBranches(fixed), [])
})
