const PROJECT_ID = 'DqQnbOV55Kw'

module.exports = {
  PROJECT_ID,
  GRAPHQL_URL: `https://zion-app.functorz.com/zero/${PROJECT_ID}/api/graphql-v2`,
  // Zion 微信小程序授权完成后，填入服务端的 code 换 JWT 地址。
  AUTH_EXCHANGE_URL: '',
  // 本地界面开发期间使用演示数据；接入微信授权后改为 false。
  MOCK_MODE: true,
  ACTION_FLOWS: {
    INITIALIZE_CURRENT_USER: {
      id: '5a450fd8-c485-40c0-8e23-b00788ecf104',
      versionId: 4
    },
    LIST_SUBSIDIARIES: {
      id: '7729de8a-be63-4e47-ab36-96e9607e3b47',
      versionId: 1
    },
    COURSE_HOME: {
      id: '25a52db3-c8a2-4afd-b298-7e5c9b1dbaed',
      versionId: 1
    },
    STUDY_LEARNERS: {
      id: '9d714235-4bcf-47f1-9b9d-a99fd542bc12',
      versionId: 1
    }
  }
}
