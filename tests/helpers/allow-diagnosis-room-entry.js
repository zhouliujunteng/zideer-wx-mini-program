// pages/diagnosis-room 不带老师邀请打开时只给「请从老师的邀请进入」（utils/diagnosis-room-entry.js）。
// 测对话引擎本身（发送、事件流、语音、历史）的测试不经过邀请：引入本文件把入口放开。
// 入口拦截本身在 tests/diagnosis-room-entry-gate.test.js 里用真实实现测。
const entryPath = require.resolve('../../utils/diagnosis-room-entry.js')

require.cache[entryPath] = {
  id: entryPath,
  filename: entryPath,
  loaded: true,
  exports: {
    diagnosisRoomEntryAllowed: () => true
  }
}
