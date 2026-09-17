const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../integrations/zion/profile/bind-wechat-phone.js'), 'utf8')
const stateSource = fs.readFileSync(path.join(__dirname, '../integrations/zion/profile/read-phone-login-state.js'), 'utf8')

function run(options = {}) {
  const queries = [], apiCalls = []
  let result
  const args = { accountId: 7, phoneCode: 'fixture-authorization-code', openid: 'server-openid', accessToken: 'server-token', ...options.args }
  const context = {
    getArg: key => args[key], setResult: value => { result = value },
    callThirdPartyApi(id, params) { apiCalls.push({ id, params }); if (options.providerThrows) throw new Error('secret must not escape'); return options.response || { code: 200, data: JSON.stringify({ errcode: 0, phone_info: { purePhoneNumber: '13800000000', countryCode: '86' } }) } },
    runGql(name, query, variables, permission) {
      queries.push({ name, query, variables, permission })
      assert.equal(permission.role, 'admin')
      if (name === 'PhoneBindingAccount') return { account: options.absent ? [] : [{ id: 7, fz_phone_number: options.existing || '' }] }
      if (name === 'CheckPhoneCollision') return { account: options.collision ? [{ id: 8 }] : [] }
      if (name === 'ReserveVerifiedPhone') { if (options.concurrent) throw new Error('unique violation with sensitive detail'); return { insert_phone_login_binding_one: { id: 1 } } }
      if (name === 'BindVerifiedPhone') { if (options.updateThrows) throw new Error('database failure'); return { update_account: { affected_rows: options.changed ? 0 : 1 } } }
      throw new Error(`Unexpected query ${name}`)
    }
  }
  let error
  try { vm.runInNewContext(`(function(){${source}})()`, { context }) } catch (value) { error = value }
  return { result, error, queries, apiCalls }
}

test('server verifies authorization against trusted OpenID and only persists official phone', () => {
  const r = run({ args: { phone: 'attacker-phone', account_id: 99 } })
  assert.equal(r.error, undefined)
  assert.equal(r.result.phoneVerified, true)
  assert.equal(r.apiCalls[0].params.ylm5isr74.openid, 'server-openid')
  assert.equal(r.apiCalls[0].params.g6o8n4oui, 'server-token')
  assert.equal(r.queries.find(q => q.name === 'BindVerifiedPhone').variables.phone, '13800000000')
  assert.equal(r.queries.find(q => q.name === 'BindVerifiedPhone').variables.id, 7)
  assert.ok(r.queries.findIndex(q => q.name === 'ReserveVerifiedPhone') < r.queries.findIndex(q => q.name === 'BindVerifiedPhone'))
  assert.equal(JSON.stringify(r.result), '{"phoneVerified":true}')
})

test('already-bound account retries are idempotent and consume no extra authorization code', () => {
  const r = run({ existing: '13800000000' })
  assert.equal(r.error, undefined)
  assert.equal(r.apiCalls.length, 0)
  assert.equal(r.queries.length, 1)
})

for (const [label, options, error] of [
  ['missing identity', { args: { accountId: null } }, 'PHONE_LOGIN_REQUIRED'],
  ['deleted account', { absent: true }, 'PHONE_LOGIN_REQUIRED'],
  ['missing code', { args: { phoneCode: '' } }, 'PHONE_CODE_REQUIRED'],
  ['missing server identity', { args: { openid: '' } }, 'PHONE_PROVIDER_UNAVAILABLE'],
  ['provider exception', { providerThrows: true }, 'PHONE_PROVIDER_UNAVAILABLE'],
  ['invalid authorization', { response: { code: 200, data: { errcode: 40029 } } }, 'PHONE_CODE_EXPIRED'],
  ['provider configuration error', { response: { code: 200, data: { errcode: 40013 } } }, 'PHONE_PROVIDER_UNAVAILABLE'],
  ['invalid response', { response: { code: 200, data: 'invalid-json' } }, 'PHONE_PROVIDER_UNAVAILABLE'],
  ['invalid phone', { response: { code: 200, data: { errcode: 0, phone_info: { countryCode: '86', purePhoneNumber: 'injected' } } } }, 'PHONE_PROVIDER_UNAVAILABLE'],
  ['existing phone collision', { collision: true }, 'PHONE_ALREADY_BOUND'],
  ['concurrent phone collision', { concurrent: true }, 'PHONE_ALREADY_BOUND']
]) {
  test(`${label} never updates the account`, () => {
    const r = run(options)
    assert.equal(r.error?.message, error)
    assert.equal(r.queries.some(q => q.name === 'BindVerifiedPhone'), false)
    assert.equal(r.result, undefined)
  })
}

test('failed or changed account update never reports a successful bind', () => {
  assert.equal(run({ changed: true }).error?.message, 'PHONE_BIND_CHANGED')
  assert.equal(run({ updateThrows: true }).error?.message, 'PHONE_BIND_FAILED')
})

test('international number is normalized from official country and national number', () => {
  const r = run({ response: { code: 200, data: { errcode: 0, phone_info: { countryCode: '1', purePhoneNumber: '2025550100' } } } })
  assert.equal(r.error, undefined)
  assert.equal(r.queries.find(q => q.name === 'BindVerifiedPhone').variables.phone, '+12025550100')
})

test('phone login state comes from current server account and returns no contact details', () => {
  for (const account of [[], [{ fz_phone_number: '' }], [{ fz_phone_number: '13800000000' }]]) {
    let result
    const context = { getArg: () => 7, runGql: () => ({ account }), setResult: value => { result = value } }
    vm.runInNewContext(`(function(){${stateSource}})()`, { context })
    assert.equal(result.authenticated, account.length > 0)
    assert.equal(result.phoneVerified, !!account[0]?.fz_phone_number)
    assert.doesNotMatch(JSON.stringify(result), /13800000000/)
  }
})
