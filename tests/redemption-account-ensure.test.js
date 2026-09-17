const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('../../scripts/mp-admin/flows/redeem.code.js'), 'utf8')

function runRedeem(state = {}) {
  const operations = []
  const context = {
    getArg: name => ({code: 'ZHILU-2026', beneficiary_student_id: 7, idempotency_key: 'test-key-20260916-0001', current_account_id: 5})[name],
    runGql(name, query, variables) {
      operations.push({name, query, variables})
      if (name === 'ResolveRedemption') return {
        account_identity: [{user_principal_id: 42}],
        user_profile: [{id: 7, user_principal_id: 42, current_grade: 3, school_stage: '小学'}],
        guardian_student_relation: [],
        redemption_record: [],
        redemption_code: [{id: 100, max_uses: 1, used_count: 0, redemption_batch: {
          id: 200, status: 'active', total_count: 10, used_count: 0, per_user_limit: 1,
          active_at: null, expires_at: null,
          benefit_snapshot: {course_credit: {amount: 10}, coin: {amount: 50}},
          scope_rule: {}
        }}],
        learner_credit_account: state.creditAccount || [],
        coin_account: state.coinAccount || []
      }
      if (name === 'EnsureRedemptionCreditAccount' && state.ensureCreditThrows) throw new Error('duplicate key')
      if (name === 'EnsureRedemptionCoinAccount' && state.ensureCoinThrows) throw new Error('duplicate key')
      if (name === 'ReloadRedemptionCreditAccount') return {learner_credit_account: state.creditAccountReload || []}
      if (name === 'ReloadRedemptionCoinAccount') return {coin_account: state.coinAccountReload || []}
      if (name === 'InsertRedemptionRecord') return {insert_redemption_record_one: {id: 1}}
      if (name === 'ClaimRedemptionCode') return {update_redemption_code: {affected_rows: 1}}
      if (name === 'ClaimRedemptionBatch') return {update_redemption_batch: {affected_rows: 1}}
      if (name === 'GrantRedemptionCredit') return {update_learner_credit_account: {returning: [{id: variables.id, available_credits: 10, frozen_credits: 0, consumed_credits: 0}]}}
      if (name === 'InsertRedemptionCreditBatch') return {insert_learner_credit_batch_one: {id: 11}}
      if (name === 'InsertRedemptionCreditLedger') return {insert_credit_ledger_one: {id: 12}}
      if (name === 'GrantRedemptionCoin') return {update_coin_account: {returning: [{id: variables.id, available_coins: 50, frozen_coins: 0, withdrawn_coins: 0}]}}
      if (name === 'InsertRedemptionCoinLedger') return {insert_coin_ledger_one: {id: 13}}
      throw new Error('Unexpected operation: ' + name)
    },
    setResult: value => { state.result = value }
  }
  vm.runInNewContext('(function(){' + source + '})()', {context})
  return operations
}

test('new student without benefit accounts gets zero-balance accounts created before redemption succeeds', () => {
  const state = {creditAccount: [], coinAccount: [], creditAccountReload: [{id: 302, available_credits: 0, frozen_credits: 0, consumed_credits: 0}], coinAccountReload: [{id: 402, available_coins: 0, frozen_coins: 0, withdrawn_coins: 0}]}
  const ops = runRedeem(state)
  const ensureCredit = ops.find(op => op.name === 'EnsureRedemptionCreditAccount')
  const ensureCoin = ops.find(op => op.name === 'EnsureRedemptionCoinAccount')
  assert.ok(ensureCredit, 'credit account insert should run for accountless student')
  assert.ok(ensureCoin, 'coin account insert should run for accountless student')
  assert.equal(ensureCredit.variables.profileId, 7)
  assert.ok(/insert_learner_credit_account_one/.test(ensureCredit.query) && ensureCredit.query.includes('status:"active"'))
  assert.ok(ops.find(op => op.name === 'ReloadRedemptionCreditAccount').variables.studentId, 7)
  // 发放必须落在补建后重读到的账户 id 上
  assert.equal(ops.find(op => op.name === 'GrantRedemptionCredit').variables.id, 302)
  assert.equal(ops.find(op => op.name === 'GrantRedemptionCoin').variables.id, 402)
  // result 产自 vm 沙箱（跨 context 原型不同），用 JSON 文本对比
  assert.equal(JSON.stringify(state.result), JSON.stringify({ok: true, replayed: false, redemption_record_id: 1, benefits: {course_credit: 10, coin: 50, experience_product_access: null}}))
})

test('students with existing accounts skip the ensure inserts entirely', () => {
  const ops = runRedeem({creditAccount: [{id: 301, available_credits: 0, frozen_credits: 0, consumed_credits: 0}], coinAccount: [{id: 401, available_coins: 0, frozen_coins: 0, withdrawn_coins: 0}]})
  assert.equal(ops.some(op => /^Ensure|^Reload/.test(op.name)), false)
  assert.equal(ops.find(op => op.name === 'GrantRedemptionCredit').variables.id, 301)
})

test('concurrent duplicate insert is tolerated when the reload finds the account', () => {
  const state = {creditAccount: [], coinAccount: [], ensureCreditThrows: true, ensureCoinThrows: true, creditAccountReload: [{id: 302, available_credits: 0, frozen_credits: 0, consumed_credits: 0}], coinAccountReload: [{id: 402, available_coins: 0, frozen_coins: 0, withdrawn_coins: 0}]}
  const ops = runRedeem(state)
  assert.equal(state.result.ok, true)
  assert.equal(ops.find(op => op.name === 'GrantRedemptionCoin').variables.id, 402)
})

test('still fails with REDEMPTION_ACCOUNT_NOT_READY when the account cannot be established', () => {
  assert.throws(() => runRedeem({creditAccount: [], coinAccount: [], creditAccountReload: [], coinAccountReload: []}), /REDEMPTION_ACCOUNT_NOT_READY/)
  // 只有金币账户补不上时同样失败
  assert.throws(() => runRedeem({creditAccount: [{id: 301, available_credits: 0, frozen_credits: 0, consumed_credits: 0}], coinAccount: [], coinAccountReload: []}), /REDEMPTION_ACCOUNT_NOT_READY/)
})
