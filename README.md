# 知鹿私课小程序

这是原生微信小程序本地工程。使用微信开发者工具导入 `miniprogram` 目录并选择“不使用云服务”。

## 当前状态

- 已完成课程入口、当前用户资料和附属账号列表的界面与 Zion 调用封装。
- 默认 `MOCK_MODE: true`，便于未绑定微信授权时本地完成界面开发。
- 切换真实后端前，在 `config/index.js` 中将 `MOCK_MODE` 改为 `false`，并填写 `AUTH_EXCHANGE_URL`。

## 真实登录前置条件

1. 在 Zion 编辑器绑定微信小程序授权。
2. 完成 code 换 Zion Runtime JWT 的服务端配置。
3. 将本地 `project.config.json` 的 `appid` 改为实际小程序 AppID。

终端用户代码中不能放 Zion Admin Token 或微信 AppSecret。
