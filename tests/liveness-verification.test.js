const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

// 「提交当前家长活体核验」（刷脸）已停用（2026-10-13 用户规则：去掉人脸识别流程）。
// 节点只回 disabled：不读库、不调聚合收费接口、不写任何数据；谁调都一样。
const read = (path) => fs.readFileSync(require.resolve(path), 'utf8')
const source = read('../../OpenMAIC-sync/integrations/zion/vendor/learning-crypto.js') + '\n(function(){' + read('../integrations/zion/profile/submit-liveness-verification.js') + '})()'

test('the face check flow is disabled: no reads, no writes, no paid API call', () => {
  const touched = []
  let result
  const context = {
    getArg: (key) => ({ name: '测试姓名', idCardNumber: '11010519491231002X', videoBase64: 'A'.repeat(4000), accountId: 7 })[key],
    setResult: (value) => { result = value },
    runGql: (name) => { touched.push(name); return {} },
    callThirdPartyApi: (id) => { touched.push('api:' + id); return {} }
  }
  vm.runInNewContext(source, { context }, { timeout: 500 })
  assert.deepEqual(touched, [])
  assert.equal(result.status, 'disabled')
})
