// 实名认证后锁定的个人资料（2026-09-26 用户规则）：生日、性别、户籍地以身份证为准，填好后不能再改。
// 读取资料、保存资料、提交实名三个动作流上线时都把本文件拼在自己源码前面
// （scripts/mp-admin/deploy-verified-profile.mjs），测试也照样拼接，三处推算只有这一份。
//
// 实名记录（guardian_verification 里 verification_status = verified 的那条）→ 锁定值：
// - 生日：身份证号第 7-14 位（lookup_summary.id_birth_date）；更早的记录只有资料解析的 birthday（形如 1990年01月01日）。
// - 性别：身份证号第 17 位奇数为男、偶数为女（lookup_summary.id_gender）；更早的记录从证件号尾号推出
//   （id_number_tail 存的是后 4 位，第 17 位是其中第 3 位），都没有时用资料解析的 sex。
// - 户籍地：资料解析接口返回的发证地省、市（身份证号前 6 位对应的地区）。当时接口没返回就没有这项，
//   不锁定，用户可以自己填。
// 代码里不写中文字面量（性别用 \u 转义）：Zion 回读节点代码时中文偶尔乱码，上线核对只比 ASCII。
function householdRegionText(province, city) {
  var parts = [province, city].map(function (value) { return String(value || '').trim(); }).filter(Boolean);
  // 直辖市的省、市同名（北京市 北京市），只留一个
  return parts.filter(function (value, index) { return parts.indexOf(value) === index; }).join(' ').slice(0, 40);
}

function verifiedIdentity(record) {
  if (!record) return null;
  var summary = record.lookup_summary;
  if (typeof summary === 'string') { try { summary = JSON.parse(summary); } catch (error) { summary = null; } }
  summary = summary || {};
  var birth = String(summary.id_birth_date || summary.birthday || '').match(/^(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
  var tail = String(record.id_number_tail || '');
  var sex = String(summary.sex || '');
  var gender = summary.id_gender === 'male' || summary.id_gender === 'female' ? summary.id_gender
    : /^\d{3}[\dX]$/.test(tail) ? (Number(tail.charAt(2)) % 2 ? 'male' : 'female')
    : sex === '\u7537' ? 'male' : sex === '\u5973' ? 'female' : '';
  return {
    birthday: birth ? birth[1] + '-' + ('0' + birth[2]).slice(-2) + '-' + ('0' + birth[3]).slice(-2) : '',
    gender: gender,
    household_region: householdRegionText(summary.province, summary.city)
  };
}
