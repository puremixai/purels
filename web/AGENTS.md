# Purels Web 前端要求

本文档约束 `web/` 下所有前端代码的设计、组件实现和验收方式。

## 1. 项目基线

- 使用现有技术栈：Next.js 16、React 19、App Router、Tailwind CSS 4、TypeScript。
- 保留现有路由、API Client、认证流程、权限模型、双语能力和后端接口，不为了视觉改版迁移框架。
- 主要入口包括首页、登录、注册、控制台概览、链接管理、统计、审计、用户管理和设置页面；控制台统一从 `/home` 进入。
- `/admin` 仅作为兼容旧链接的跳转入口，新的导航、认证跳转和内部路由必须使用 `/home`。
- 页面级代码不得直接修改后端接口语义；需要适配数据时，在前端组件或 `src/lib` 中增加明确的适配函数。
- 当前默认字体继续使用项目已经引入的 Geist，并保留中文字体回退，避免新增外部字体运行时依赖。

## 2. 核心设计决策

Purels 前端必须以 [Rare UI](https://www.rareui.com/) 作为唯一的视觉和交互参考，形成统一的 RareUI-first 设计系统。

“完全统一使用”包括以下要求：

- 首页、登录注册页、后台壳体和所有管理页面使用同一套深色视觉 Token。
- 所有新增的按钮、字段、面板、状态、筛选器、导航和动效必须通过 RareUI 源码组件或本项目的 RareUI 适配层实现。
- 不新增 Ant Design、MUI、Chakra、Mantine 等第二套 UI 组件库。
- RareUI 未覆盖的语义化表格、表单和布局原语，必须按相同 Token 封装，不能重新发明一套视觉规则。
- 不强行把所有 RareUI 组件塞进页面；组件必须与真实业务语义匹配，不能为了展示动画而增加无数据、无功能的交互。
- RareUI 组件采用源码归属方式维护在项目内，不依赖一个不可控的整体 UI 包。

参考组件：

- [Bounce Sidebar](https://www.rareui.com/components/bouncesidebar)：后台主导航。
- [Gooey Nav](https://www.rareui.com/components/gooeynav)：统计时间范围、状态筛选等互斥选项。
- [Animated Counter](https://www.rareui.com/components/animatedcounter)：首页、概览和统计指标。
- [Fluid Orb](https://www.rareui.com/components/fluidorb)：首页 Hero 和合适的空状态视觉焦点。
- [Scroll Progress](https://www.rareui.com/components/scrollprogressindicator)：首页和较长设置页面。
- [Code Block](https://www.rareui.com/components/codeblock)：自托管启动命令展示。
- [OTP Input](https://www.rareui.com/components/otpinput)：登录 MFA 和安全设置中的一次性验证码。
- [Delete Button](https://www.rareui.com/components/deletebutton)：链接、OIDC、用户等破坏性操作。
- [Duration Picker](https://www.rareui.com/components/durationpicker)：运行时设置中的小时/分钟间隔配置。
- Task List：首次使用引导和真正存在任务语义的空状态。

## 3. 视觉 Token

所有颜色、圆角、阴影和动效时长集中定义在 `src/app/globals.css`。业务页面禁止散落新的硬编码色值、阴影或圆角。

建议基线：

```css
--ui-canvas: #09090b;
--ui-surface: #121214;
--ui-surface-elevated: #19191d;
--ui-line: #2a2a2f;
--ui-line-strong: #3a3a42;
--ui-ink: #f7f7f5;
--ui-ink-soft: #d2d2d7;
--ui-muted: #9999a2;
--ui-faint: #686871;
--ui-accent: #f75001;
--ui-accent-strong: #d94100;
--ui-accent-tint: #2b160d;
--ui-success: #48d597;
--ui-warning: #f2b84b;
--ui-danger: #ff6b5b;
--ui-radius-control: 10px;
--ui-radius-panel: 16px;
--ui-radius-hero: 32px;
--ui-radius-pill: 999px;
```

视觉规则：

- 使用近黑色，不使用刺眼的纯黑大面积背景。
- 只保留橙色作为品牌强调色；成功、警告、危险色仅用于状态表达。
- 禁止继续使用旧的蓝色品牌色作为主要交互色。
- 内容表面使用细边框、轻微内阴影和层级差，不使用泛滥的黑色投影。
- 卡片不应全部做成相同高度和相同圆角；根据层级区分控件、面板、Hero 和浮层。
- 大标题使用 `text-wrap: balance` 或 `text-wrap: pretty`，正文宽度控制在约 65 个字符以内。
- 数字指标必须使用等宽数字或 `font-variant-numeric: tabular-nums`。
- 留白服务于分组和阅读，不以“大空白”制造高级感；后台优先保证信息密度和首屏可见信息量。

## 4. RareUI 组件组织

新增组件放在以下目录：

```text
src/components/ui/rare/
  bounce-sidebar.tsx
  gooey-nav.tsx
  fluid-orb.tsx
  animated-counter.tsx
  scroll-progress.tsx
  code-block.tsx
  otp-input.tsx
  delete-button.tsx
  duration-picker.tsx

src/components/rare/
  rare-button.tsx
  rare-field.tsx
  rare-panel.tsx
  rare-status.tsx
  rare-segmented.tsx
  rare-loading.tsx
```

要求：

- `ui/rare` 只保存经过审计的 RareUI 源码组件；不要在其中混入业务请求和业务文案。
- `components/rare` 负责 Purels 的 Token、国际化、Next Link、权限和无障碍适配。
- 业务页面优先使用 `components/rare`，不直接复制一套新的 RareUI className。
- 每个组件必须有明确的 TypeScript props 类型，并保留 RareUI 原组件的可配置能力。
- 使用 RareUI 组件前先确认其依赖存在于 `package.json`，不得产生幽灵 import。
- 首阶段优先引入 `motion`；只有真正使用时才增加 `prism-react-renderer`、`figma-squircle`、`flubber`、`react-use-measure` 或 `@radix-ui/react-slot`。
- `Fluid Orb` 等可能依赖浏览器能力的组件必须评估 SSR 和 hydration；必要时使用客户端边界或动态加载，并提供静态降级视觉。

## 5. 页面要求

### 5.1 首页

涉及：`src/app/page.tsx`、`src/components/home/*`。

- 使用深色 RareUI Hero，Fluid Orb 作为主视觉焦点，但不能遮挡标题和 CTA。
- 首页指标使用 Animated Counter。
- 自托管命令区域使用 Code Block。
- 功能区使用非对称布局和大圆角表面，避免六个完全等宽的普通卡片。
- 使用 Scroll Progress 辅助长页面阅读。
- 保留 SEO metadata、注册开关、双语文案和现有锚点。

### 5.2 登录和注册

涉及：`src/app/login/page.tsx`、`src/app/register/page.tsx`。

- 登录、注册和 MFA 状态必须共享同一套暗色认证布局。
- MFA 验证使用 OTP Input，支持输入、粘贴、自动聚焦、成功和错误状态。
- 保留 OIDC、Turnstile、语言切换和已有 smoke test 所依赖的表单结构。
- 加载状态使用按钮内状态和结构化 skeleton，不使用无上下文的旋转图标。

### 5.3 后台壳体

涉及：`src/components/admin-shell.tsx`。

- 使用 Bounce Sidebar 替换当前普通侧边栏视觉，同时保留权限过滤、当前路由高亮、移动端菜单和退出登录。
- active 状态使用橙色弹性指示器，不能仅依赖颜色表达当前页面。
- 顶部 Header、用户标识、语言切换和内容区域必须与侧边栏共享 Token。
- 移动端必须保留可访问的打开、关闭、遮罩和 Escape 行为。

### 5.4 Dashboard

涉及：`src/app/home/page.tsx`。

- KPI 使用 Animated Counter，并设置 tabular numbers。
- 空数据时提供真实的首次使用引导；不得只显示“暂无数据”。
- 最近链接保留语义化列表和状态标签。
- API 加载失败显示内联错误面板，并提供可理解的重试或返回路径。

### 5.5 链接管理

涉及：

- `src/app/home/links/page.tsx`
- `src/app/home/links/new/page.tsx`
- `src/app/home/links/[id]/edit/page.tsx`
- `src/components/qr-dialog.tsx`

要求：

- 状态、排序和时间范围等互斥选项使用 Gooey Nav 或统一的 RareUI segmented 适配器。
- 删除操作使用 Delete Button，禁止使用原生 `confirm()`、`alert()`。
- 保留搜索、分页、批量操作、CSV 导入导出、二维码、目标检查和分流规则。
- 表格保留 `<table>` 语义；小屏允许横向滚动，不得裁剪操作列。
- 新建和编辑表单共享同一套字段、错误、保存中和取消行为。

### 5.6 统计页

涉及：`src/app/home/stats/page.tsx`。

- 日期范围和 top/bottom 切换使用 Gooey Nav。
- 总点击量、访客数等指标使用 Animated Counter。
- 保留现有轻量图表实现，不为视觉改版引入重量级图表库。
- 图表、排名、明细日志分别提供加载、空数据和错误状态。
- 保留 CSV 导出和链接明细行为。

### 5.7 设置、审计和用户页

涉及：`src/app/home/settings/*`、`src/app/home/audit/page.tsx`、`src/app/home/users/page.tsx`。

- 所有设置页共享统一的标题、说明、分组面板和保存工具栏。
- Runtime Settings 中可表达为小时/分钟的间隔使用 Duration Picker，并明确完成秒数转换和边界校验。
- OIDC、用户和其他破坏性操作使用 Delete Button 或内联确认，不使用浏览器原生确认框。
- 403、网络错误、保存成功、保存失败和无权限状态必须有清晰的文字反馈。
- 审计日志和用户表格保留语义化结构、键盘可达性和分页能力。

## 6. 动效要求

- 所有动效优先使用 `transform`、`opacity` 和 RareUI/Motion spring，不动画化 `top`、`left`、`width`、`height`。
- 普通交互时长建议为 160–300ms；弹性动效必须有明确的业务反馈，不得让页面持续晃动。
- 页面首次进入可以使用轻量级 stagger，但不要让所有内容同时从四周飞入。
- 列表刷新、分页和筛选不得造成明显布局跳动。
- 必须支持 `prefers-reduced-motion: reduce`：关闭 Fluid Orb、弹性位移、stagger 和非必要的滚动动画，但保留状态变化和可读反馈。
- 动效不能成为唯一的信息表达方式；当前页、成功、错误、禁用等状态必须有文本、结构或图标辅助。

## 7. 无障碍与交互状态

每个交互组件至少覆盖：

- default
- hover
- focus-visible
- active/pressed
- disabled
- loading
- empty
- error
- success

必须满足：

- 使用语义化的 `nav`、`main`、`section`、`aside`、`article`、`table`、`label`、`button` 和 `form`。
- 所有可交互元素支持键盘操作，并有明显的 `focus-visible` 样式。
- 表单字段必须有可关联的 label、placeholder 不能代替 label。
- 错误信息使用内联文本或 `aria-live`，禁止依赖 `window.alert()`。
- 弹层支持 Escape、点击外部关闭、焦点管理和明确的关闭按钮。
- 图像和有意义的 SVG 必须有可理解的替代文本；纯装饰内容标记为装饰。
- 正文和控件颜色满足 WCAG AA 对比度要求。
- 至少提供 skip link，后台页面需要明确的主内容区域。

## 8. 国际化和数据要求

- 所有用户可见文案必须进入现有 i18n 消息文件，不得在组件中硬编码中文或英文。
- 新增文案必须同时提供 `zh-CN` 和 `en`。
- 数字、日期、时间、百分比和状态文案使用现有格式化工具。
- 不使用虚假的统计数字、占位用户和 Lorem ipsum。
- 所有 API 错误都通过现有 `errorText` 或等价适配函数展示可理解的消息。
- 不为了视觉展示伪造通知数量、统计数据或权限状态。

## 9. 性能与安全边界

- 继续使用服务器组件可以使用服务器组件；只有存在交互或浏览器 API 时才使用客户端组件。
- 重型 RareUI 动效组件按页面需要加载，不要在根布局中无条件加载全部组件。
- 不新增远程图片、远程字体或不可控的第三方脚本作为视觉依赖。
- 不在前端日志、错误信息或组件 props 中泄露 token、client secret、完整用户敏感信息。
- 不改变现有认证 cookie、API 请求和权限判断逻辑。
- 不为了展示动画引入 WebGL、Canvas 或大型依赖；必须有明确收益和静态降级。

## 10. 验收标准

完成任何页面改造后，至少执行：

```powershell
npm run lint
npm run typecheck
npm run build
```

涉及业务流程时继续执行仓库已有的 smoke scripts，例如：

```powershell
node ..\scripts\smoke-pages.mjs
node ..\scripts\smoke-users.mjs
node ..\scripts\smoke-totp.mjs
node ..\scripts\smoke-oidc.mjs
node ..\scripts\smoke-captcha.mjs
```

视觉和交互验收至少覆盖：

- 360px 手机宽度。
- 768px 平板宽度。
- 1280px 和 1440px 桌面宽度。
- 中文和英文。
- 未登录、无权限、空数据、加载中、保存成功、保存失败和网络错误。
- 鼠标、键盘、Escape、Tab、Enter、Space 和 `prefers-reduced-motion`。

Definition of Done：

- 所有页面使用统一的 RareUI-first Token，不存在旧浅色蓝色 UI 残留。
- 没有第二套 UI 库、原生 confirm/alert、硬编码业务文案或无法解释的装饰动画。
- 现有 API、路由、权限、国际化和数据操作全部保持可用。
- 新增依赖已写入 `package.json` 和 lockfile，且每个依赖都对应实际使用场景。
- Lint、TypeScript、生产构建和相关 smoke test 均通过。
- Reduced Motion、键盘焦点、错误状态和空状态均经过验证。

## 11. 严格 UI 审查门禁

本节是页面合并前的硬性审查规则。违反 P0 规则不得合并；总分低于 90 分必须返工，80–89 分只能在完成整改后复审。

### 11.1 P0 阻断项

- 路由、登录跳转、权限判断、表单提交、删除、导出或返回操作失效。
- 360px、768px、1280px 任一宽度出现横向溢出、内容裁切、操作列不可达或固定层遮挡正文。
- 页面缺少与当前业务状态匹配的加载中、空数据、错误、成功或无权限反馈。
- 键盘无法到达、无法操作或无法退出关键控件；焦点不可见；弹层无法 Escape 关闭。
- 文本与背景、控件边界或错误状态不满足 WCAG AA；颜色是唯一的状态表达方式。
- 页面出现第二套组件库、未注册 Token 的颜色/圆角/阴影，或直接使用原生 `alert` / `confirm`。
- 认证、API、国际化、权限和 SEO 行为被视觉改造破坏。

### 11.2 空间预算

- 后台 Header 高度控制在 56–64px；桌面侧栏控制在 224–240px；主内容桌面内边距 24px，移动端 16px。
- 区块间距只允许 12、16、24、32px 四档；超过 48px 必须在审查记录中说明业务原因。
- 控件高度默认为 40px；移动端可操作目标至少 44px；表格行高控制在 44–48px。
- 面板内边距默认 16–20px；同一语义不得出现“面板套面板套卡片”。
- 1280px 首屏必须同时看到页面标题、主要操作和第一组真实数据或明确的加载骨架。
- 禁止用空的 `min-height`、重复 `py-*`、无内容占位、过大的 `gap` 或装饰性边距推低真实内容。
- 一个页面只保留一个 H1 和一个主操作；次要操作降级为文本按钮、图标按钮或菜单。

### 11.3 视觉一致性

- 业务页面只使用 `globals.css` 中的 Token；禁止页面内新增品牌色、渐变、发光、阴影和任意圆角。
- 品牌强调色只使用橙色；蓝色不得作为主要 CTA、链接或 active 状态。
- 面板、控件、浮层和胶囊必须有明确层级，不能所有元素都使用相同圆角、同样阴影和同样边框。
- 图标必须来自现有 Icon 或已审计 RareUI 组件；禁止 emoji、混合图标风格和无语义装饰图标。
- 数字指标使用 tabular numbers；表格、金额、时间和状态保持列对齐，不用占位符撑高布局。
- 中英文切换后标题、按钮、表格和错误文案不能溢出；禁止在组件中硬编码用户可见文案。

### 11.4 状态与交互

每个可交互组件都要检查 default、hover、focus-visible、active、disabled、loading、empty、error、success；不适用的状态需要在审查记录中标明原因。

- 加载状态保留原布局，不使用会导致跳动的全屏 spinner；优先使用轻量 skeleton 或按钮内状态。
- 空状态必须告诉用户为什么为空以及下一步能做什么；禁止只显示“暂无数据”。
- 错误状态必须靠近错误源，包含可理解的原因和恢复路径；网络错误不能只显示技术错误码。
- 成功状态必须有文本或结构反馈，不能只依赖颜色、动画或 Toast 短暂闪过。
- hover/focus/active 只动画 `transform` 和 `opacity`；普通交互 160–300ms，并支持 reduced motion。

### 11.5 审查评分

每项 0–2 分，总分 100 分；P0 直接判定不通过。

| 维度 | 权重 | 通过标准 |
| --- | ---: | --- |
| 结构与空间效率 | 25 | 无无意义留白，首屏信息密度达标，层级可扫描 |
| 视觉 Token 一致性 | 20 | 颜色、圆角、阴影、控件高度全部来自统一系统 |
| 状态完整性 | 20 | 加载、空、错、成功、禁用和无权限均可理解 |
| 交互与无障碍 | 20 | 键盘、焦点、语义、对比度、Escape 和移动端目标达标 |
| 响应式与国际化 | 10 | 360/768/1280/1440 与中英文均不溢出 |
| 性能与动效克制 | 5 | 无布局跳动，无重型依赖，动画不阻碍任务 |

审查证据至少包括：四档宽度截图或录屏、深色/浅色主题、中文/英文、加载/空/错/成功状态，以及 `npm run lint`、`npm run typecheck`、`npm run build` 输出。评分表和发现的问题必须随页面改造记录在 PR 或任务说明中。

## 11. 推荐实施顺序

1. 修改 `src/app/globals.css`，建立深色 RareUI Token 和通用适配器。
2. 引入并审计 `motion` 及核心 RareUI 源码组件。
3. 改造 `AdminShell`、登录、注册和 MFA。
4. 改造 Dashboard、链接管理和统计页。
5. 改造设置、审计、用户和首页。
6. 做响应式、无障碍、Reduced Motion、构建和 smoke test 验收。

任何实现如果与本文件冲突，应优先修改实现；只有确认需求变化后才修改本文件。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
