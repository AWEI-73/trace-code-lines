---
name: trace-code-lines
version: 1.20.0
description: 查線、依賴、孤兒候選、這條路線有沒有跑過、到底哪份程式在跑、專案或 skill 有沒有寫歪時使用。讀版本、原碼與宣告，交付可追到證據的體檢卡；需要動態證據時，在授權隔離副本用測試或情境試跑。一般寫碼或設計諮詢不觸發。
---

# 查程式碼線工具組

預設做輕量檢查：靜態查線，加 agent 讀碼，加報告。適用一般 repo、工具、skill 與服務，不綁特定框架。每個結論附來源、版本、母體與缺口；缺證據寫 UNKNOWN。

## 預設路徑

1. **確認正在讀哪份**：讀 README、SKILL.md 與版本指標；多層設定用 `version-chain.mjs`。hash 不冒充 Git commit。需要時讀 [runner](references/runner.md)。
2. **找入口並讀碼**：`discover-entries.mjs <repo>` 列出命令列、網頁路由、匯出函式、技能腳本、MCP 工具、GAS API 候選。agent 逐一讀 README 與原碼，補漏、確認參數與輸出，保留搜尋範圍；清冊不是完整性保證。
3. **靜態查線**：`derive-map.mjs --config <file>` 產出閉包與終點候選。設定與原碼必須綁到同一快照；不從檔名猜功能。需要時讀 [runner](references/runner.md)、[evidence](references/evidence.md)。
4. **宣告與實作對照**：agent 從 README、SKILL.md 與註解抽出宣告，每項附文件與原碼兩邊錨點。分類為「說了沒做」「做了沒說」「流程對不上」；找不到證據寫 UNKNOWN。負面結論需可重跑的搜尋範圍。格式見 [體檢卡](references/check-card.md)。
阻擋點亦屬宣告對照：提供政策清單與 reason／關鍵字表，分底線、要處理、不確定；無宣告只列清單，防呆與混合條件不硬判。設定、錨點與限制見[阻擋點](references/stop-sites.md)。

5. **交付**：`report.mjs --config <file>` 產出原有健檢；再用 `check-card.mjs --config <file>` 寫入 check-card.md、check-card.json 與健檢 HTML 的新增章節。卡片列入口、輸入、輸出、副作用、費用、工具、能否執行及宣告對照。快速靜態入口與安裝方法見 [README](README.md)。

維修單的合併、標記、錨點核對與試跑對照規則見 [維修單](references/maintenance.md)。

## 需要「水有沒有流過」時

只有需要執行證據且已獲授權時，才讀 [水源與情境](references/water-sources.md) 及 [儀器](references/instrumentation.md)。
水源可換成既有紀錄／卡帶、隔離測試錄帶，或 agent 寫 scenarios.json 順 API 試跑。螢光魚只記錄覆蓋、收據及邊界。
每個情境最多三次嘗試；每次保存計畫、錯誤與機器判決。失敗後由 agent 讀錯誤再修情境；不得改掉預期結果湊通過。裁判只採覆蓋、收據或錨點，agent 敘述不算證據。
證據由強到弱：真實使用 ＞ AGENT_DRIVEN_STUBBED ＞ 測試跑過 ＞ 只有靜態；替身不能升格為真實使用。

按需讀取：
- 跨 repo 依賴方向用 `boundary.mjs`；分類、錨點與缺口見 [boundary](references/boundary.md)。
- 反查入口、importer 與回退條件：[reach](references/reach.md)，只提供判讀提示。
- 既有事件分類、普查與路線骨架：[record-census](references/record-census.md)；單案連結：[runtime-tools](references/runtime-tools.md)。
- 覆蓋對帳與語言限制：[language-support](references/language-support.md)。
- 隔離試跑或拆除試驗：[run-once](references/run-once.md)。程序成功與候選拆除結果分開，逐候選列出。
- 外部推論與缺口對帳：[inference-runtime](references/inference-runtime.md)。
- 只有要求時才做 [流程圖](references/flowchart.md) 或 [路線動態圖](references/route-map.md)。

## 邊界

- 原 repo 只讀。執行只在授權隔離副本；輸出與暫存只寫授權位置，保留來源 hash 與前後檢查。
- 依賴只照既有鎖定檔安裝，關閉安裝腳本；缺鎖定檔就不自行補套件。
- 試跑移除金鑰與 token、拒絕網路；模型及付費服務只用替身、現成假資料或既有錄音。花錢、登入真帳號、部署、寄信、正式資料寫入與 push 是硬停。
- 每個實驗獨立 TEMP，執行後清程序與暫存、核對監聽埠。儀器是 API 掛勾，不是作業系統沙盒；Python audit 不能改寫子程序 argv。
- 靜態邊與候選不是執行證據；exit 0 只代表程序成功，須另列回傳狀態。沒有觀測到不等於沒人用或可刪除。
- 工具只用 Node 內建模組／Python 標準庫；不跟隨 symlink，不猜外部根。HTML 支援字面 script src；打包器設定、一般計算式動態 import、完整 AST、跨檔資料流仍有限制。
- 保留原換行；Node UTF-8 寫入後讀回並計 CJK、?、U+FFFD、CR。修改 JS 跑 node --check 與既有 self-test。不新增測試檔。
- 同一項同一原因連續兩次修正仍失敗，還原該項並標 FAIL。公開包不含私人路徑、片段與案例輸出。

## 版本

目前版本：1.20.0（2026-10-26）。歷史見 [changelog](references/changelog.md)。
