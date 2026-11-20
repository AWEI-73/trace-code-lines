---
name: trace-code-lines
metadata:
  version: 1.38.0-rc.1
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

從用途開始（JS/TS/Python，最快拿到「怎麼接」）：把「我想怎麼用」縮成一句，`route` 從 README／package.json／pyproject、setup.cfg、setup.py 的 console_scripts、`__main__.py` 找真正的入口，沿語法樹一站一站追到讀檔、轉換、輸出與錯誤；只有這條路真的走到的連網、跑程式、寫檔才算接入條件，repo 別處有的另列。加 `--trial` 在隔離副本、無網路下用假檔試跑正常、重跑、格式錯、檔案不存在四種情況；`--run` 寫 `< {input}` 時改從標準輸入餵檔，第四種換成空輸入。Python 試跑只用機器上已有的套件（不安裝），缺套件會列出來。只想確認「功能有沒有接好」用 `wired`。

`--trial` 沒給 `--run` 時自動推論：在無網路副本跑 `--help`，加上 README／docs 用法（略過 changelog 與斷行續行），挑對到問句的指令與旗標（如 `insert … --csv`），印出「試跑指令（推論）」與依據；`--run` 一律優先。會開連線埠的路線改用只有本機回環的命名空間：等服務起來、用 GET 試讀、再關掉，記下回應與前後檔案變化。click／typer／argparse 子指令、commander／yargs、Express／Fastify／Koa、Flask／FastAPI 的註冊視為入口；問句點名的指令或路由（或由「寫進」等動詞、文件用法推論，標成推論）才進路線。加 `--preflight <答覆.json>` 時，報告「能不能接」逐項標已准／沒准；`report --card <卡片.json> --route <路線.json> --out <報告.html>` 產單一合併報告（怎麼接 → 能不能接 → 接線 → 路線 → 試跑 → 細節收合）。

多入口與 monorepo：workspaces／packages/*（含 Python src 版面）都列為入口，依問句字、主套件或範例外掛、文件用法次數排序，只挑一個，其餘放「其他候選」（附分數與理由，`--entry` 可換）；多條路由對上時也只挑最相關的一條。外掛式註冊（多個類別都有 `convert()`）依問句挑類別（docx → DocxConverter），標成推論。試跑依問句做假檔（CSV／JSON／DOCX／PDF／HTML／Markdown），好檔帶標記字串，用來確認內容真的轉出來；在空的工作資料夾執行（repo 自己的設定檔不套用）。報告的「接線」一節是可直接拿去接的合約：呼叫方式、給什麼、拿回什麼、成功失敗訊號（含逾時建議）、動到的檔、要准的能力、還要試的未知，加一份步驟描述（輸入／輸出／execution_class／停下條件）；JSON 版在路線檔的 `adapter`。

要接進自己的系統時加 `--target <系統 repo> [--target-name 名稱]`：先在目標系統找同功能的東西再談缺口（以格式／工作命名的模組或函式、做這件事的知名套件、只接受副檔名或文件提到、已經裝了這個工具的哪個版本），分「讀進來」與「產出」兩個方向，結果寫進「怎麼接」與「接線」的「已有／缺口」表；只看 git 追蹤的檔，測試、退役與暫存副本不算。問句要的能力（PDF、PPTX、codemod…）若在這條入口走不到的地方（例如介面按鈕），報告會點名檔案與誰載入它。工具類 repo：建立專案的指令（init／create…）在空資料夾跑、沒網路卡住時改用 `--help` 列的離線旗標再跑、同資料夾重跑看會不會拒絕；問句點名多個指令時（元件→component、AGENTS.md→init、codemod→upgrade，含各指令 `--help` 的範例），在同一個假專案依序各跑一次，分出只讀與會寫檔的，寫到家目錄或暫存的也列出。pnpm 每個套件的 node_modules、tsconfig `paths` 別名、被忽略的 dist／build 產物（改讀原始碼）、`importSrc('x.mjs')` 這類動態載入小幫手都會處理；很大的 monorepo 只解析入口套件與它的程式真的有 import 的 workspace 套件，測試、stories、fixtures、範例、benchmark 不解析（範圍寫在未知）。

介面按鈕試跑：問句要的格式只在介面檔（如 `export-pdf.ts`、`export-pptx.ts`）時，`--trial` 會同時在隔離副本開 dev 伺服器（找依賴放按鈕套件的 app 的 dev／start 指令，只開本機回環），用無頭瀏覽器（Python Playwright＋Chrome／Chromium；`TCL_PLAYWRIGHT_PYTHON` 指定 python）點按鈕（必要時先開 Download／Export 選單），收下載檔；按鈕叫瀏覽器列印時由無頭瀏覽器代替列印對話框存 PDF。產出會驗：PDF 頁數、頁面大小、有沒有可選取文字；PPTX 投影片數、第 1 張可編輯文字。對外連線、主控台錯誤、副本與家目錄的寫入都列出。沒有驅動或 dev 指令時說明原因並略過；`--no-ui-trial` 關掉，`--ui-keep <資料夾>` 保留產出。

已有／缺口只把程式證據算「已有」：被別的程式 import 的同名模組、被呼叫的函式、import 或宣告依賴的知名套件；定義了沒人用算「部分」；只在文件提到的另列「只有文件提到」（弱）。寫檔、跑程式、連網的站會標出觸發條件與對應旗標（「加 --outfile <值> 才會寫檔」，含提早 return 的分支，推論）；`--trial` 遇到有條件的寫檔，會在副本加那個旗標再跑一次，報告寫出的新檔與原檔有沒有被覆蓋。入口、試跑用法、路由有多個候選時，報告「怎麼挑的」列分數與理由，第二名很接近時在怎麼接寫出來並給換的方法。

草稿、抽取結果引用文件的數字時，用 `check-quotes` 把每個數字與單位對回引用的 檔:行：不在原文、單位不同（字 vs words）會失敗；只對到原文範圍的一端（22–28px 的 28px）標「要看」；標明換算（÷、換算、=）的另列。

```text
node scripts/trace.mjs check-quotes --map OS=<repo>,WL=<repo> 草稿.md …   # 也可 node scripts/check-quotes.mjs …；--json 給機器讀
```

```text
node scripts/trace.mjs route --root <repo> --question "給它一份 CSV，它能不能只讀這份檔，然後把 JSON 交回來？" --out <路線.json> --html <報告.html> [--trial [--run "python3 -m 套件 --csv < {input}"]] [--preflight <答覆.json>] [--target <系統 repo> --target-name 名稱] [--entry bin:名稱|library|檔] [--fn 檔:函式] [--no-ui-trial] [--ui-keep <資料夾>]
node scripts/trace.mjs wired --root <repo> --from 檔:函式 --to 函式 --out <路線.json> [--html <報告.html>]
node scripts/trace.mjs route-report --route <路線.json> --out <報告.html> --answer "讀碼後改寫的怎麼接"
```

語法樹要先在 skill 資料夾跑一次 `npm install --ignore-scripts`（web-tree-sitter＋JS/TS/Python 語法，免編譯）；沒裝時自動退回文字比對，報告會標明。Python 的 `importlib.import_module(f'pkg.parsers.{x}')` 這類動態載入，會依問句的字挑對應模組（標成推論），前綴對不到 repo 的會標成「載入 repo 以外的程式碼」。讀不出來的動態呼叫、沒追進的外部套件、推論接上的站都列在「未知」；推論的站要讀碼或試跑確認。

開卡前先問清楚（接入或要試跑時必做）：`preflight` 只讀掃環境與受查 repo，印出給負責人的問題原文（甲乙丙一鍵回、附建議）；掃描能決定的不問。

```text
node scripts/trace.mjs preflight --root <repo> --out <問題.json> [--paths 子目錄] [--mode <情境>]
node scripts/trace.mjs answer --questions <問題.json> --out <答覆.json> --by "誰回的" [--accept-defaults] [--set 1=乙]
node scripts/trace.mjs start … --preflight <答覆.json>
node scripts/trace.mjs report --card <卡片.json> --out <報告.html>
```

問題只在開卡前問，查到一半不追問；沒回覆＝沒准，接入結論最多「有條件可接」；演練用的模擬回覆一定加 `--simulated`。`report` 唯讀跑分診、套用不查範圍、產鏈卡與單檔離線網頁（給負責人看的結論與給 agent 的機器資料在同一頁）。

一鍵填卡：`node scripts/trace.mjs fill --card <卡> --step <n> --note "說明" --anchor "檔:行:文字"`；可重複錨點，跳步加 `--skip`，寫回即核對並印下一步。
同命令可加 `--chain "一站"`、`--conflict "現象|方向"`、`--cleared "排除項"`、`--verify "檢查|結果"`、`--unknown "問題|類別|原因|試過|下一步|成本|理解|會不會改變本題結論"`；末欄可省略：`yes`＝會、`no`＝不會、`unsure`＝不確定；接入欄位見 [接入分診](references/integrate.md)。
下一步只顯示第一個尚未完成的步驟。未知是誠實交代原因與目前解釋，不是待辦；探索以本卡的一句問題、固定流程以成品與宣告的驗收項目為終點，只補會或可能改變結論的未知，驗收未明須補證據或明寫交付限制，其餘僅記錄；不為清零擴張調查或自動開卡，值得另追的只留一句「另一個問題」。
走完用 `report` 一次產鏈卡與網頁，或用印出的 `chain-card.mjs --config <卡片.json> --out <證據目錄>` 只產鏈卡並讀回；核對引用不代替語意覆核或實際重現。

## 需要時才讀

- [劇本用法、通則與常見原因](references/playbooks.md)；步驟只在 [資料檔](assets/playbooks.json)。
- [接入分診與接入卡](references/integrate.md)：邊界、機密、流向、相依及既有掃描結果；只交待確認的候選。
- [鏈卡格式與錨點](references/chain-card.md)、[未知的交代與補查邊界](references/unknown-playbook.md)。
- [原有細查路徑](references/detailed-workflow.md)：五步盤點、宣告對照、刪除影響、動態證據及專門工具，內容完整保留。
- [整輪盤點](references/audit.md)、[原有健檢](references/check-card.md)、[快速入口與安裝](README.md)。

## 邊界

- 原 repo 只讀；輸出與暫存只寫授權位置，試跑僅在授權隔離副本，保留來源與前後核對。
- 先讀記錄再讀碼，固定版本；每跳一站留錨點，分清文件宣告、程式能力與實際記錄。
- 本題需要補查時先選低成本方法；付費、真帳號、部署、寄信、正式資料寫入與推送須有明確授權。
- 靜態候選不當執行證據；沒有觀測不等於無人使用或可刪。負面結論附範圍。
- 工具只用內建模組，不跟隨連結、不猜外部根；套件與試跑細則按需讀原有細查路徑。
- 修改後 UTF-8 讀回、語法檢查與既有自測；不新增測試檔。同項同因連續兩次修正仍失敗，還原並標失敗。

## 版本

目前版本：1.38.0-rc.1（2026-11-20，測試中）。歷史見 [changelog](references/changelog.md)。
