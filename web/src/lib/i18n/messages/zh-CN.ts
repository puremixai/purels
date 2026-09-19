import type { Dictionary } from "./en";

/**
 * The Chinese dictionary.
 *
 * Typed as Dictionary, so a key missing here is a compile error and a key that
 * does not exist in the English source is rejected as an excess property. The
 * wording is the console's original copy, unchanged: this is the language the
 * UI shipped in, and the batch that added English should not reword it.
 *
 * Counts do not inflect, so every key is a plain string even where English
 * stores a one/other pair.
 */
export const zhCN: Dictionary = {
  "app.title": "Purels 管理后台",
  "app.description": "Purels 链接管理与运营后台",

  "nav.overview": "概览",
  "nav.links": "链接管理",
  "nav.stats": "数据统计",
  "nav.audit": "操作日志",
  "nav.users": "用户管理",
  "nav.roles": "角色权限",
  "nav.oidc": "登录方式",
  "nav.analytics": "埋点统计",
  "nav.security": "安全设置",
  "nav.captcha": "注册保护",

  "shell.console": "管理后台",
  "shell.workspace": "工作台",
  "shell.welcome": "欢迎回来",
  "shell.welcomeNamed": "欢迎回来，{username}",
  "shell.logout": "退出登录",
  "shell.loggingOut": "正在退出...",
  "shell.closeMenu": "关闭菜单",
  "shell.openMenu": "打开菜单",
  "shell.language": "语言",

  "login.subtitle": "短链接管理后台",
  "login.heading": "登录",
  "login.mfaHeading": "两步验证",
  "login.username": "用户名",
  "login.password": "密码",
  "login.code": "验证码",
  "login.submit": "登录",
  "login.submitting": "登录中...",
  "login.verify": "验证",
  "login.verifying": "验证中...",
  "login.back": "返回",
  "login.or": "或",
  "login.noAccount": "没有账号？",
  "login.register": "注册",
  "login.failed": "登录失败，请稍后重试",
  "login.verifyFailed": "验证失败，请稍后重试",

  "oidcError.oidc_not_provisioned": "无法为这个身份找到可用的账号，请联系管理员。",
  "oidcError.oidc_state": "这次登录已失效，请重新开始。",
  "oidcError.oidc_exchange": "身份提供方没有完成这次登录，请重试。",
  "oidcError.oidc_unavailable": "该登录方式当前不可用，请联系管理员。",
  "oidcError.oidc_failed": "登录失败，请重试。",

  "register.heading": "注册",
  "register.username": "用户名",
  "register.password": "密码",
  "register.submit": "注册",
  "register.submitting": "注册中...",
  "register.haveAccount": "已有账号？",
  "register.login": "登录",
  "register.completeCaptcha": "请完成验证",
  "register.captchaLoadFailed": "无法加载注册验证",
  "register.failed": "注册失败，请稍后重试",

  "turnstile.loadFailed": "验证加载失败，请重试",

  "role.admin": "管理员",
  "role.operator": "运营",
  "role.readonly": "只读",
  "role.user": "用户",

  "error.network": "无法连接到 API 服务，请检查后端地址。",
  "error.session_expired": "登录已过期，请重新登录。",
  "error.http_error": "请求失败（{status}）",
  "error.invalid_request": "请求无法读取。",
  "error.unauthorized": "未登录或登录已过期。",
  "error.insufficient_scope": "没有权限执行该操作。",
  "error.csrf_required": "安全令牌缺失，请刷新页面。",
  "error.csrf_invalid": "安全令牌无效，请刷新页面。",
  "error.csrf_unavailable": "无法获取安全令牌，请刷新页面。",
  "error.not_found": "该记录不存在或已被删除。",
  "error.conflict": "该记录已存在。",
  "error.rate_limited": "操作过于频繁，请稍后再试。",
  "error.internal_error": "出错了，请重试。",
  "error.database_unavailable": "数据库暂时不可用。",
  "error.registration_disabled": "该部署未开放注册。",
  "error.invalid_credentials": "用户名或密码不正确。",
  "error.invalid_second_factor": "验证码不正确或已过期。",
  "error.two_factor_unavailable": "该部署未启用两步验证。",
  "error.no_enrolment": "没有进行中的绑定。",
  "error.quota_exceeded": "已达到链接数量上限。",
  "error.last_capability_holder": "至少需要保留一个拥有该权限的启用账号。",
  "error.secrets_unavailable": "该部署无法保存加密密钥，请设置 SECRET_ENCRYPTION_KEY。",
  "error.oidc_slug_immutable": "标识创建后不可修改，请新增一个登录方式。",
  "error.captcha_unavailable": "注册保护暂时不可用。",
  "error.captcha_invalid": "验证未通过，请重试。",
  "error.captcha_invalid_settings": "注册保护配置无效。",
  "error.captcha_secrets_unavailable": "该部署无法保存加密密钥，请设置 SECRET_ENCRYPTION_KEY。",
  "error.analytics_invalid": "埋点配置无效。",

  "error.load": "加载失败",
  "error.save": "保存失败",
  "error.create": "创建失败",
  "error.update": "更新失败",
  "error.delete": "删除失败",
  "error.revoke": "撤销失败",
  "error.reset": "重置失败",
  "error.operation": "操作失败",
};
