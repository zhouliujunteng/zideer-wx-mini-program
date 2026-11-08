// 「提交当前家长活体核验」（视频活体核验 / 刷脸）已停用（2026-10-13 用户规则：去掉人脸识别流程，不要了）。
// 小程序已删掉人脸核验页与「完善信息」页，这里只留一个直接拒绝的节点：不读视频、不调聚合收费接口、不写任何数据。
// 动作流和聚合接口配置先留在 Zion（没有客户端入口、也不再调用），以后真要恢复，旧代码在
// scripts/promotion-settlement/baseline/liveness-verification.live-20261013.js。
context.setResult({ status: 'disabled', message: '人脸核验已停用' });
