---
name: youtube-publishing-rules
description: YouTube Data API v3 發片完整規則 — description 不能含 < > 字元(`>>` `&&` 會被退稿)、Shorts 自動歸類條件、Shorts description 連結要放第一行(播放器預設收合,畫面只露第一行)、quota 1600/upload、refresh_token 7 天過期沒辦法 cron 自動 refresh、OAuth scope 不含留言與字幕(需 youtube.force-ssl)、videos.update 只改指定欄位不會覆寫手動改過的其他欄位、視覺與標題長度限制。任何要寫 YT 自動發片或改 metadata 的 AI 應該先讀。
---

# YouTube Publishing — Data API v3 完整規則

> 2026-11-27 使用者：「不一定要找嚴格規則如果Google有更新的話主要是以上傳方便 seo為主」「是因為怕YouTube token過期不知道要怎麼自動續所以寫的規則」。本檔是 API 踩坑參考，不是硬性流程：上傳以方便與 SEO 為主，YouTube Studio 瀏覽器上傳（可直接傳字幕、縮圖）或 API 腳本都可以，token 過期就改用 Studio；Google 規則有更新以官方為準。

## 1. ⚠️ Description 字元黑名單(最容易踩)

YT API 會 reject 含特定 ASCII 字元的 description,回傳 `invalidDescription`:
- **`<`** 跟 **`>`**(出於 XSS 防護,connector 字元)
- 影響範圍:不能直接貼 shell 指令裡的 `>>`(redirect)、`<file>`(stdin)、HTML-like syntax

### 解法
- 影片用到的 shell 指令 **不要直接貼 description**,改成「指令到 GitHub README 複製」
- 或用 Unicode 替代字元(`≫` U+226B 看起來像 `>>` 但合法)
- 或用敘述式:「把 export 那行 append 到 ~/.zshrc 並 source 一次」

### 其他字元限制
- 長度上限 **5000 字元**(含換行)
- emoji / Unicode box drawing(`──`)/ 中文標點都 OK
- URL 自動 hyperlink(IG 不會,YT 會)

## 2. Title / Tags 規格

| 欄位 | 上限 | 備註 |
|---|---|---|
| Title | 100 字元 | 過長 API 退稿 |
| Description | 5000 字元 | 見上 |
| Tags(個別) | 30 字元 | API 不擋,但 YT UI 會截 |
| Tags(總長度) | 500 字元(所有 tag 加逗號) | 超過 API 退稿 |

## 3. Shorts 自動歸類

YT **沒有 `isShort` API flag**。Shorts 是自動判定:

**符合三條件 → 自動進 Shorts feed:**
1. **垂直比 9:16**(1080×1920 之類,正方形也勉強算)
2. **長度 ≤ 3 分鐘**(2024 起放寬,以前 60s)
3. (推薦,但非必要)title / description 含 `#Shorts`

實作上**直接用 `videos.insert` 上傳垂直短 mp4 就好**,跟一般 video API 路徑完全相同。可加 `--shorts` flag 自動把 `#Shorts` 塞進 description 前 100 字(YT 演算法看這段做歸類,不用強制排第一行)。若同一支 description 第一行要留給連結(見 §4),`#Shorts` 排到連結後面一樣有效。

## 4. Shorts Description 第一行規則(2026-08-08 實測)

⚠️ Shorts 播放器的說明欄預設收起,畫面只露得出**第一行**。如果影片 CTA 口頭講了「連結在資訊欄」,連結沒放第一行就是**承諾跳票**——觀眾照著做卻找不到東西,不只是排版問題。

### 實測案例
- 發 grill-me 短影音(`WJTOLIYwDBs`)時,description 排成:第 1 行 `#Shorts`、第 3 行開場說明句、連結排到第 6 行
- 使用者回報「資訊欄沒有放 repo 連結」。用 API 逐字讀回來,連結其實在第 6 行——但畫面只露得出第一行,等於沒放
- 對照使用者指定的參考片(頻道「Debug 土撥鼠」,`hnidu5Kprig`,52 秒,12,310 次觀看):description **整份只有 40 個字元、只有一行**:
  ```
  連結：https://github.com/ayghri/i-have-adhd
  ```
  沒有開場說明句,也沒有 hashtag(hashtag 全放在標題,不進 description)

### 規則
- **連結放第 1 行**,格式 `連結：https://…`(注意:別照抄成角括號佔位符,`<` `>` 會讓 description 被退稿,見 §1)
- `#Shorts` 排到連結後面就好——只要落在前 100 字元內,§3 的演算法歸類效果一樣有,不用搶第一行
- 改法用 `videos.update`,**不用重發整支影片**,50 quota 點(見 §6)

### 未驗證
純文字 URL 在 YouTube 手機 App 上長按能不能複製——**沒查證過**,只能打 API 讀資料,看不到 App 實際渲染結果。可以確定的是 description 裡的指令字串(例如 `npx skills add ...`)不是可複製的。

## 5. Token 生命週期(踩坑警告)

### Testing mode 下 refresh_token 7 天死
- `youtube.upload` scope 是 **restricted scope**,Testing mode 下 refresh_token 只活 7 天
- ⚠️ **用 refresh_token 換 access_token 不會延長 refresh_token 自身的 7 天倒數** — cron 自動 refresh **沒用**
- 拿新 refresh_token 必須重做整套 OAuth(瀏覽器人工同意),不可 headless

### 實務最佳解
- 接受每週手動跑一次 `node scripts/youtube-oauth.mjs`(30 秒)
- 永久不死 → Google verification(送審 4-6 週)或 Workspace + Internal app type

### Scope 涵蓋範圍有限(2026-08-08 實測)
- 現行 token 的 `auth/youtube` scope **不含留言與字幕**
- 實測 `commentThreads.list` 回 403 `insufficientPermissions`
- 發留言、`captions.insert`(上傳 SRT)都需要 `youtube.force-ssl` scope,現行 token 做不到
- 要用這兩個功能得重跑 OAuth 並把 `youtube.force-ssl` 加進 scope 清單,7 天效期規則(見上)一樣適用

## 6. Quota

- 預設 **每天 10,000 點**
- `videos.insert`(上傳新影片):**1,600 點/支** → 一天最多 6 支
- `videos.update`(改 metadata):50 點/次
- `thumbnails.set`:50 點/次
- 超過要去 Cloud Console 申請 quota(要寫使用情境)

**改 metadata 不算重發** — title / description / tags / category / 縮圖都可透過 `videos.update` + `thumbnails.set` 更新,**只有影片 binary 不能換**(要刪重發)。

## 7. 視覺規格

- 縮圖:JPG / PNG,< 2MB,1280×720 16:9
- 影片:mp4,< 256GB,< 12 小時(個人發片不會碰到上限)
- categoryId 常用:
  - `28` = Science & Technology(本專案 default)
  - `27` = Education
  - `22` = People & Blogs

## 8. API / 腳本邊界

實作走 `scripts/publish-youtube.mjs`(已存在)。**跟 IG/Threads 不同 — YT 直接 binary 上傳,不用先 host**。

### Visibility 預設 private 安全

`--visibility` 不帶就是 private,確認 metadata 都對才改 public。改 visibility 用 `videos.update` 50 quota 點,很便宜。

### 三段操作(本專案 publish-youtube.mjs 的流程)

1. `refresh_token → access_token`(換一小時臨時 token)
2. `POST videos.insert?uploadType=multipart&part=snippet,status`(JSON metadata + 影片 binary)
3. (選填)`POST thumbnails.set` 上自訂縮圖

### videos.update 不會覆寫手動改過的欄位(2026-08-08 實測)

- `scripts/update-youtube.mjs` 的邏輯是先 `videos.list` 讀現況,再只改指定的欄位,不是整包蓋掉
- 實測:使用者在 YouTube Studio 手動改過標題,之後跑 `--description-file` 只更新 description,標題原封不動
- 換句話說:改 metadata 的腳本要走「讀現況 → 局部改 → 寫回」,不能直接組一包新 snippet 送出(那樣沒帶到的欄位會被清空)

## 9. 失敗處理

| 錯誤 | 解法 |
|---|---|
| `invalidDescription` | 找 `<` `>` 字元 / 超 5000 字 / 內容違規(政治 / 暴力 / 兒少不宜),最常見 `>>` `<` 在貼 shell 指令時 |
| `invalid_grant` 換 access_token 時 | refresh_token 過期 → 重跑 `youtube-oauth.mjs` |
| `accessNotConfigured` | YouTube Data API v3 沒在 Google Cloud project 啟用 → 去 Cloud Console enable |
| `quotaExceeded` | 今天 quota 用完(發 6 支或大量 update),等 24h 或申請增加 |
| `selfDeclaredMadeForKids` 必填 | metadata 一定要含 `status.selfDeclaredMadeForKids: false`(本專案已固定 false) |
| `insufficientPermissions`(403) | scope 不夠,常見於 `commentThreads.list` / `captions.insert` — 現行 `auth/youtube` scope 不含留言與字幕,要重跑 OAuth 加 `youtube.force-ssl`(見 §5) |

## 10. 跟其他平台共版時

- YT description **可以放完整連結**(IG 不行、脆有字數限制)→ 把 GitHub repo / 圖文教學 / 影片提到的指令(避開 `>>`)都塞 description
- YT title 用 ASCII `|` 沒問題(脆要 `｜`)
- **YT 不用 hashtag 區塊**(IG 規則),tags 走 metadata 欄位即可
