const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const labels = require('../utils/business-labels')

test('known source, settlement and redemption codes have Chinese labels and unknown codes stay hidden', () => {
  for (const value of ['redemption', 'purchase', 'manual', 'future_source']) assert.doesNotMatch(labels.sourceLabel(value), /[A-Za-z]/)
  for (const value of ['course_generation_freeze', 'course_generation_consume', 'course_generation_return', 'course_generation_failure_release', 'course_generation_limit_release', 'future_code']) assert.doesNotMatch(labels.businessLabel(value), /[A-Za-z]/)
  for (const value of ['active', 'pending', 'SUCCESS', 'succeeded', 'failed', 'future_status']) assert.doesNotMatch(labels.statusLabel(value), /[A-Za-z]/)
  assert.equal(labels.statusLabel('已支付'), '已支付')
  assert.equal(labels.businessLabel('', 'freeze', 'coin'), '金币冻结')
})

test('templates do not print raw runtime business and status codes', () => {
  const violations = []
  function inspect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) inspect(file)
      else if (file.endsWith('.wxml')) {
        for (const text of fs.readFileSync(file, 'utf8').matchAll(/>([^<>]*)</g)) {
          for (const binding of text[1].matchAll(/\{\{([^}]+)\}\}/g)) {
            if (/\.(?:source_type|business_type|entry_type|scene_type|status)(?![A-Za-z])/.test(binding[1]) && !binding[1].includes('?')) violations.push(path.relative(__dirname, file) + ': ' + binding[1])
          }
        }
      }
    }
  }
  inspect(path.join(__dirname, '..'))
  assert.deepEqual(violations, [])
})
