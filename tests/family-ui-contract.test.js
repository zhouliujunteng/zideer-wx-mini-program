const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
// account/family 已改用设计师新版设计语言（自定义顶栏 + FAFAFA + 白卡）；
// 其余家庭相关页面仍沿用旧版 account tokens。
// account/guardian-dashboard 2026-09-25 改为设计稿 M50（自定义顶栏、蓝色渐变顶区），见下方单独的测试。
const legacyAccountPages = [
  'account/binding-code',
  'account/bind-student'
]

test('legacy family-facing pages import the designer account tokens', () => {
  for (const page of legacyAccountPages) {
    const wxss = fs.readFileSync(path.join(root, page, 'index.wxss'), 'utf8')
    assert.match(wxss, /@import ["']\.\.\/\.\.\/styles\/account-form\.wxss["'];/)
  }
})

test('family page follows the new designer language', () => {
  const wxss = fs.readFileSync(path.join(root, 'account/family/index.wxss'), 'utf8')
  const template = fs.readFileSync(path.join(root, 'account/family/index.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(root, 'account/family/index.json'), 'utf8'))
  // 自定义顶栏 + 米白底 + 氛围丝带 + 白色圆角卡
  assert.equal(json.navigationStyle, 'custom')
  assert.match(wxss, /background:\s*#FAFAFA/)
  assert.match(wxss, /\.family-ambient-ribbon/)
  assert.match(wxss, /border-radius:\s*30rpx/)
  assert.match(template, /family-topbar-title/)
  assert.match(template, /family-state/)
  assert.doesNotMatch(template, /commerce-skeleton/)
  assert.doesNotMatch(template, /family-skeleton/)
})

test('guardian dashboard follows the designer M50 layout', () => {
  const wxss = fs.readFileSync(path.join(root, 'account/guardian-dashboard/index.wxss'), 'utf8')
  const template = fs.readFileSync(path.join(root, 'account/guardian-dashboard/index.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(root, 'account/guardian-dashboard/index.json'), 'utf8'))
  assert.equal(json.navigationStyle, 'custom')
  assert.match(wxss, /\.dashboard-ambient \{[^}]*linear-gradient\(180deg, #1E87FD/)
  for (const label of ['学习情况', '学习诊断', '学习计划', '更多']) assert.ok(fs.readFileSync(path.join(root, 'account/guardian-dashboard/index.js'), 'utf8').includes(`label: '${label}'`))
  // 没有后端数据的设计稿模块不放演示数据
  assert.equal(/作业动态|previewNote|本地演示/.test(template), false)
})
