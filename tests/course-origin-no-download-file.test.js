// 课程服务 course.zideer.cn 只在 request 合法域名里、不在 downloadFile 合法域名里：
// 从课程服务取文件（PDF 报告等）一律 wx.request + responseType arraybuffer 再写文件，不能用 wx.downloadFile。
// 2026-11-11 代理免费体验的 PDF 报告用了 downloadFile，真机上一直「报告没有下载下来」。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name.startsWith('.')) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return jsFiles(full)
    return entry.name.endsWith('.js') ? [full] : []
  })
}

test('wx.downloadFile 不下载课程服务地址', () => {
  const offenders = []
  for (const file of jsFiles(root)) {
    const source = fs.readFileSync(file, 'utf8')
    const pattern = /wx\.downloadFile\(\{[\s\S]{0,300}?url:\s*([^\n]+)/g
    let match
    while ((match = pattern.exec(source))) {
      if (/coursePortalOrigin|COURSE_PORTAL_ORIGIN|course\.zideer\.cn/.test(match[1])) {
        offenders.push(`${path.relative(root, file)}: ${match[1].trim()}`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})

test('代理免费体验报告走 request 取二进制', () => {
  const source = fs.readFileSync(path.join(root, 'services/identity.js'), 'utf8')
  const body = source.slice(source.indexOf('async function downloadAgentTrialReport'), source.indexOf('async function loadAgentApplication'))
  assert.match(body, /wx\.request\(/)
  assert.match(body, /responseType: 'arraybuffer'/)
  assert.match(body, /writeFile\(/)
})
