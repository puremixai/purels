# 途中画册：跳转页面设计稿

运行 `node docs/redirect-gallery/serve.mjs`，打开 `http://localhost:3174/?review=1`。

此目录保留独立的可交互设计稿。正式实现已接入 `internal/http/handler/gallery.go` 与 `internal/http/handler/gallery/`，通过 Go embed 随 API 一起部署；访问任意已有短链接的 `+` 预览页即可查看。

本目录设计稿的预览默认暂停，方便查看；「预览选项」可查看六幅作品和重新演示 2 / 5 / 10 秒倒计时。预览控件只在设计稿 `review=1` 时出现。设计稿普通入口默认 2 秒后抵达本地 `destination.html` 演示终点。正式页面使用真实链接的目标和倒计时配置，不识别这些原型参数。

## 设计

- 页头使用“途中画册”小篆风格字标，四字为手绘 SVG 路径，不依赖设备字体；正式页面内嵌 `internal/http/handler/gallery/wordmark.svg`。英文保留文字标题。
- 暖黑展墙、浅色装裱，作品占主要空间；横幅与竖幅均保持完整比例。
- 作品旁显示标题、作者、年代、两句画面介绍和原作资料；注明这是名画的像素演绎。
- 底部固定信息层级：最终目标域名、可展开的完整地址、倒计时、停留欣赏、立即前往。桌面是一条窄栏，手机用两行紧凑底栏。
- 「停留欣赏」真正停止计时，「继续倒计时」从剩余时间继续；不会轮换作品。
- 每次进入仅随机选一幅并请求该 SVG。29 个 fine SVG 原样复制自用户提供的 viewer.html 配套目录。
- `?review=1&lang=en` 查看英文；`?mode=preview` 演示短链接 `+` 预览模式，不自动离开。

字标以圆转、匀细、纵长的笔形重新设计，参考传统篆字的部件结构，不是历史字帖的摹本。“画、册”使用“畫、冊”的传统构形；“途”按“辵 + 余”作篆意设计。字形参考教育部《异体字字典》的[中](https://dict.variants.moe.edu.tw/dictView.jsp?ID=159&la=1)、[畫](https://dict.variants.moe.edu.tw/dictView.jsp?ID=28496&la=1)、[冊](https://dict.variants.moe.edu.tw/dictView.jsp?educode=A00297)、[途](https://dict.variants.moe.edu.tw/dictView.jsp?ID=-45346)字条。

## 正式实现的行为

1. 保持原链接配置的倒计时时长（当前默认 2 秒，支持 0–60 秒），不为画册延长时间。
2. Go 服务端每请求随机选一幅，嵌入可信 SVG 和对应语言文案；响应只携带选中的作品，无额外图片请求。
3. JavaScript 计时取代全局 meta refresh，暂停真正阻止导航并保留余时；无脚本环境在 noscript 中保留倒计时跳转和手动链接。返回浏览器缓存页面后保持暂停。
4. 普通访问沿用现有计数，`+` 预览不计数、不自动跳转。暂停、恢复不访问短码接口，不增加点击。
5. 目标域名、完整地址和 CTA 来自同一个经设备规则与查询参数合并后的目标。继续转义动态文字与链接。
6. 保留语言协商、no-store、noindex/nofollow、HEAD 无正文及不计点击；静态画作、键盘焦点、图片替代文字和 reduced-motion。

此目录设计稿展示故宫网站地址作为排版示例，跳转进入本地演示终点；正式 Go 页面已使用短链接解析后的真实目标。

## 验证

浏览器检查覆盖 2 秒自动跳转、暂停后停留、从剩余时间恢复、立即前往、无倒计时预览、每次仅加载一张 SVG，以及 29 幅作品的中英文与桌面、手机布局。另检查完整地址展开与 Escape 关闭、手机滚动到底后正文不被底栏遮住。

正式实现可运行：`go test ./...`、`node --test scripts/redirect-gallery.test.mjs` 和 `node scripts/redirect-gallery.e2e.mjs`。浏览器检查导出并服务实际 Go 模板，覆盖全部双语画作、宽窄屏、真实导航、暂停后无导航、无 JavaScript 回退、完整 URL 的滚动展示。浏览器脚本通过 `PLAYWRIGHT_MODULE` 指向已安装的 Playwright，截图保存在忽略的 `coverage/redirect-gallery-browser/`。
