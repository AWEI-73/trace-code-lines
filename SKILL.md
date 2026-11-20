---
name: trace-code-lines
metadata:
  version: 1.38.0-rc.4
description: 查線、依賴、孤兒候選、這條路線有沒有跑過、到底哪份程式在跑、專案或 skill 有沒有寫歪時使用。讀版本、原碼與宣告，沿問題讀碼，交付可追到證據的鏈卡；需要動態證據時，在授權隔離副本用測試或情境試跑。一般寫碼或設計諮詢不觸發。
---


# 查程式碼線工具組

一個問題、一張有來源的鏈卡。先依情境開卡，每次只讀步進器給的這一步，不必載入整套方法。

## 從這裡開始

- 壞了、錯值、很慢或沒發生：`symptom`。
- 接手陌生儲存庫：`takeover`。
- 改、刪、搬或改名前：`change`。
- 接入外部工具前：`integrate`。

```text
node scripts/trace.mjs start --mode <情境> --question "一句問題" --root <repo> --out <卡片.json>
node scripts/trace.mjs next --card <卡片.json>
node scripts/trace.mjs status --card <卡片.json>
```

想知道某工具怎麼用、能不能接進自己的系統（JS/TS/Python）：`route`；只確認功能有沒有接好：`wired`；草稿引用的數字對回原文：`check-quotes`。用法與能力邊界見 [用途路線](references/route.md)。

接入或要試跑時，先 `preflight`，再 `answer --agent-defaults`：讀檔、寫檔、跑其他程式與隔離試跑由 agent 依預設答，只有連外網、花錢、真帳號、機密、讓模型下系統指令才問負責人。`--trial` 只在答覆准了試跑、而且建得出網路隔離時才跑，否則一律不跑並寫明原因。

一鍵填卡：`node scripts/trace.mjs fill --card <卡> --step <n> --note "說明" --anchor "檔:行:文字"`；可重複錨點，跳步加 `--skip`，寫回即核對並印下一步。
同命令可加 `--chain "一站"`、`--conflict "現象|方向"`、`--cleared "排除項"`、`--verify "檢查|結果"`、`--unknown "問題|類別|原因|試過|下一步|成本|理解|會不會改變本題結論"`；末欄可省略：`yes`＝會、`no`＝不會、`unsure`＝不確定；接入欄位見 [接入分診](references/integrate.md)。
下一步只顯示第一個尚未完成的步驟。未知是誠實交代原因與目前解釋，不是待辦；探索以本卡的一句問題、固定流程以成品與宣告的驗收項目為終點，只補會或可能改變結論的未知，驗收未明須補證據或明寫交付限制，其餘僅記錄；不為清零擴張調查或自動開卡，值得另追的只留一句「另一個問題」。
走完用 `report` 一次產鏈卡與網頁，或用印出的 `chain-card.mjs --config <卡片.json> --out <證據目錄>` 只產鏈卡並讀回；核對引用不代替語意覆核或實際重現。

## 需要時才讀

- [劇本用法、通則與常見原因](references/playbooks.md)；步驟只在 [資料檔](assets/playbooks.json)。
- [接入分診與接入卡](references/integrate.md)：邊界、機密、流向、相依及既有掃描結果；只交待確認的候選。
- [鏈卡格式與錨點](references/chain-card.md)、[未知的交代與補查邊界](references/unknown-playbook.md)。
- [原有細查路徑](references/detailed-workflow.md)：五步盤點、宣告對照、刪除影響、動態證據及專門工具，內容完整保留。
- [用途路線、試跑與開卡前檢查](references/route.md)。
- [整輪盤點](references/audit.md)、[原有健檢](references/check-card.md)、[快速入口與安裝](README.md)。

## 邊界

- 原 repo 只讀；輸出與暫存只寫授權位置，試跑僅在授權隔離副本，保留來源與前後核對。
- 先讀記錄再讀碼，固定版本；每跳一站留錨點，分清文件宣告、程式能力與實際記錄。
- 本題需要補查時先選低成本方法；付費、真帳號、部署、寄信、正式資料寫入與推送須有明確授權。
- 靜態候選不當執行證據；沒有觀測不等於無人使用或可刪。負面結論附範圍。
- 工具只用內建模組（語法樹套件可選，沒裝時退回文字比對），不跟隨連結、不猜外部根；套件與試跑細則按需讀原有細查路徑。
- 修改後 UTF-8 讀回、語法檢查與既有自測；不新增測試檔。同項同因連續兩次修正仍失敗，還原並標失敗。

## 版本

目前版本：1.38.0-rc.5（2026-11-21，測試中）。歷史見 [changelog](references/changelog.md)。
