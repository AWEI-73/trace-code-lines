# 查程式碼線工具組 1.17.2

幫你找出程式從哪裡開始、用到哪些檔案，並核對文件說法與實際程式。

Trace Code Lines maps code dependencies and helps an agent compare documentation with implementation. Install the entire folder in Claude Code at ~/.claude/skills/ or Codex at ~/.codex/skills/, then ask the agent to inspect your repository. Static findings are candidates; authorized test recordings provide separate execution evidence.

## 1. 怎麼裝

解壓縮，將整個 `trace-code-lines` 資料夾放進 Claude Code 的 `~/.claude/skills/` 或 Codex 的 `~/.codex/skills/`，重新開啟對話。需要 Node.js 22 或更新版本；靜態地圖另需 Git。完整自測的 Python 覆蓋檢查需既有 Python 3，可用 TRACE_PYTHON 指定。工具只用內建模組，不用先安裝套件。

## 2. 一句話怎麼用

在要檢查的專案對話裡說：

> 幫我查這個 repo。
>
> 這個 skill 有沒有寫歪？請核對文件跟程式。

預設只讀程式。若需要看實際執行，明確指定可寫的隔離副本與暫存位置，說「可以在副本跑測試與 API 情境，外部服務用替身」。會保留每次試跑紀錄，不會把描述當成功。

想先自己拿到基本清單，可在解壓後的技能資料夾執行：

~~~text
node scripts/inspect-repo.mjs --repo /path/to/repo-copy --out /path/to/report
~~~

把範例路徑換成自己的絕對路徑；報告放在受查副本外。打開報告資料夾裡的 `health.html`。這個快速命令只列候選入口；接著讓 agent 讀原碼補齊參數、輸出與宣告對照。

## 3. 會拿到什麼

- 一張體檢卡：怎麼呼叫、要給什麼、交回什麼、會開什麼程序、是否連網或花錢、需要哪些工具。
- 可以離線打開的健檢網頁，以及方便工具讀取的 JSON。
- 每個結論的文件與程式位置；不確定的地方會直接說明。
- 有授權試跑時，附情境、覆蓋、寫入收據與替身記錄。證據分成真實使用、使用替身的情境試跑、測試跑過、只有讀碼。
- 拆除試驗會逐項說明拿掉後是否壞掉；試驗程序完成不表示可以刪除。

## 4. 邊界

原專案只讀；只有你指定的副本可以試跑。依賴只按原本鎖定檔安裝，關閉安裝腳本。缺鎖定檔時會保留限制，不自行更新套件。

執行時移除金鑰與 token、拒絕網路。付費模型、雲端運算和其他付費服務全部用替身；不登入真帳號，不部署、寄信、push 或改正式資料。每個實驗使用自己的暫存目錄，結束後清理程序並檢查監聽埠。

記錄器是在程式的 API 上掛勾，**不是作業系統沙盒**。原生程式或沒有掛勾的路徑可能看不到；需要更強隔離時，請在容器或虛擬機執行。Python 記錄器無法改寫子程序參數，所以子程序覆蓋可能不完整。看見某檔案跑過，也不代表整個功能正確。

技術設定只在需要時讀：[水源與情境](references/water-sources.md)、[體檢卡](references/check-card.md)、[靜態查線](references/runner.md)。

## 5. 授權

本專案採 [MIT 授權](LICENSE)，Copyright (c) 2026 AWEI-73。

第三方片段：scripts/self-test.mjs 保留 crewAI 的 MIT 原碼摘錄，僅供解析測試，不會匯入或執行。來源包括 CLI／開發工具的子程序呼叫，以及事件、記憶、儲存與工具模組；版本及逐段位置標在測試旁。完整版權與授權通知見 [fixture-source-license.txt](references/fixture-source-license.txt)。其他來源啟發的語法案例已改寫為合成圖書借閱範例，來源說明見 [fixture-origins](references/g13-fixture-origins.json)。
