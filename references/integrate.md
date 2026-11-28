# 接入前與接手時的分診

這是候選清冊，不是完整安全稽核；由讀碼者確認來源、傳遞、驗證與觸發條件，不判定弱點。

## 四個分診子命令

`node scripts/integrate.mjs <surface|secrets|flows|deps> --root <repo> [--paths a,b] [--out <外部檔案>] [--summary]`

- `surface`：列 JS／TS／Python 的入口、檔案讀寫刪除、環境變數名稱、網路、子程序與監聽位址。入口沿用 discover-entries，停止位置沿用 stop-sites；付費、傳送、發布及刪除名稱由 stop-sites 共用判定。不是實際執行或權限檢查證據。
- `secrets`：找常見供應商金鑰、私鑰區塊、機密名稱配長字面、已追蹤設定檔與疑似憑證進記錄。只讀已追蹤檔案；未追蹤及忽略的機密設定只列檔名，不讀內容。不是所有機密的完整偵測。
- `flows`：來源須賦給具名識別字，且該識別字或一步別名／屬性出現在動作引數；外部內容進提示詞、模型輸出到執行／工具／授權也用同一規則。共用既有函式解析，同函式才配對；未取得邊界時退為前後 40 行。
- `deps`：列鎖定檔、安裝腳本、未釘版本與網址／版本庫相依。JSON 套件宣告較完整，Python 設定採行級詞法候選；複雜宣告須讀碼。不是漏洞查詢，也不證明鎖定檔與宣告一致。

各命令回傳 JSON，包含讀取檔數、樣式類別、候選數量、略過及限制；加 `--summary` 印中文摘要。搭配 `--out` 可同時保留 JSON。
`--paths` 是根目錄下相對檔案或目錄前綴，以逗號分隔；不接受萬用字元。
預設只從 git 清單選檔，不因 git 失敗退回遍歷工作樹。缺檔、連結、超過 8 MiB 或二進位內容明列略過。
git 因擁有者不同拒讀時，明確授權後可加 `--safe-directory <repo>`，只影響該次讀取，不寫 git 設定。
`--rev <提交>` 只固定 git 檔名清單，內容讀指定根目錄；請先用該提交的 archive 建立並核對快照，不可拿現行工作樹冒充舊版。此時不列未追蹤檔名。

解壓縮資料夾明示加 `--no-git`（可搭配 `--paths`，不可搭配 `--rev`）；輸出標示未依版本控制，`fileListSha256` 核對排序檔名清單，`contentManifestSha256` 核對本命令實際分析的內容雜湊清單。
沿用 walker：最多 10,000 檔、單檔 8 MiB、合計 64 MiB；不跟隨連結，排除 .git、node_modules、常見建置輸出與二進位檔；`skipped` 附數量（排除目錄不計內部檔數），機密檔名如 .env*、私鑰、credentials*、*.local.json 只列名稱、不讀或雜湊內容。
任何子命令零掃描皆在終端印原因與下一步；JSON 模式寫至 stderr，保留 stdout 為 JSON。

## 遮蔽與錨點

機密只留前四字元及長度；原碼片段的所有字串也保守遮蔽，設定檔內容整段省略。
私鑰先整塊遮蔽再取行，避免洩漏中間行；電子郵件與個人使用者路徑也遮蔽。未知樣式與編碼過的機密可能漏報，不能代替成熟掃描器。
候選錨點保存檔、行、整檔與該行雜湊，不把原始機密放進比對文字。閱讀原檔只在已授權來源內進行。
flows 每筆附 `link.identifier`、`sourceLine`、`sinkLine`、直接／一步衍生與範圍依據；別名另附名稱及賦值行。
只有同檔共現但無關聯者不列候選，以 `cooccurrenceCounts` 每類計數，註明「僅共現，未列出」。這是來源／動作配對數，不是獨立動作數。
標準輸出／標準錯誤及 console 不算寫檔；固定子程序參數不列，shell 模式或模板命令也不能繞過具名關聯要求。
直接引數排在一步衍生之前；全批預設最多 50 筆，`omitted` 記省略數，`--all` 可全列；`totalCounts` 為截斷前、`counts` 為列出數。
提示詞沿用 stop-sites 辨識其組合運算式，也檢查模型呼叫引數；字面限制語句本身不證明流向。
跨函式、跨檔的流向找不到；零筆不代表安全。解構、複雜模板、控制流程與清理驗證未完整分析，仍可能漏報或誤報。

## 接入既有掃描結果

`node scripts/integrate.mjs import-sarif --root <repo> --file <結果.sarif> [--out <外部檔案>]`

這是額外的匯入命令：只讀已產生的 SARIF，逐個位置核對相對檔名與行號；附帶原碼片段時也核對內容。
越界、連結、不存在、缺行號或有未解析來源基底者保留未知；片段不符明列不符。不相信外部嚴重度或成功標記。
不轉印掃描器任意訊息與片段；以目前原碼的遮蔽片段產生相同候選格式。沒有掃描器就不用，不安裝、不下載、不替代成熟掃描器。

## 一次命令填卡

`trace.mjs fill --card <卡> --step <n> [--note "說明"] [--anchor "檔:行:文字"]… [--skip]`
錨點使用鏈卡原有的 ±3 行唯一校正。`fill` 先在記憶體核對整次命令，全部通過才寫卡並推進。任一參數或欄位出錯（包括 `ANCHOR_MISMATCH`）就以結束碼 1 回報，步驟與卡片原始位元組都維持原樣。修正後請重送整次命令。
同命令可重複加入章節內容；錨點歸最近一筆章節，欄位以 `|` 分隔且不可留空。

- `--chain "一站"`、`--conflict "現象|方向"`、`--cleared "查過不是問題"`、`--verify "檢查|結果"`。
- `--unknown "問題|類別|原因|試過|下一步|成本|目前解釋|會不會改變本題結論"`，末欄可省，接受 `yes`、`no`、`unsure`。類別及成本沿用 [未知對策](unknown-playbook.md)。
- 接入情境另有 `--decision "可接／有條件可接／不建議"`（三擇一）、`--condition "條件"`、`--permission "需要授權的能力與範圍"`。
- `--interface "入口|輸入|輸出|錯誤回法|重送行為"`，這些由讀碼者填，工具只核對錨點。
- 固定版本可加 `--version "提交與差異說明|執行版本說明"`；不要把靜態版本冒充已部署版本。

重送同一步會追加。先讀卡避免重複，跳步要交代原因。
走完八步用 chain-card 產卡；接入結論不授予權限、不等於禁網試接通過。
要輸出平台宣告草稿，沿既有 check-card → `export-profile.mjs`，後者只接受 check-card 格式；不要直接把接入鏈卡當成它的輸入。

## 領域知識、轉接釘選與路由

這三個欄位只用於 `integrate`。第二步可記釘選，第六步可記領域規則與路由。

薄轉接層負責呼叫入口、對照契約與讀回結果。領域規則和成品驗證可由不同工具實作，應各自留下證據。選擇路由類別及成熟度時，請對照實際取得的證據。

| `fill` 旗標 | 欄位與用途 |
| --- | --- |
| `--knowhow "kind\|rule\|toolDetail\|verification"` | `kind` 可用 `preflight`、`invariant`、`verification`、`guardrail`、`policy`。`rule` 寫換工具後仍適用的領域規則，工具內部演算法與資料結構放在 `toolDetail`，`verification` 寫怎麼檢查及要看哪份證據。 |
| `--compat-pin "surface\|target\|expectation\|probe"` | `surface` 可用 `local-process`、`mcp`、`cli`、`http`、`library`。釘選呼叫方可觀察的契約，例如 CLI 選項與結束碼、schema 必填欄位或匯出格式。避免釘選容易隨重構變動的內部原碼運算式。`probe` 說明怎麼讀回比對及何時應停下。 |
| `--routing '<JSON 物件>'` 或 `--routing-file "<路徑.json>"` | 兩種方式擇一，使用相同欄位。必填 `consumes`、`produces`、`avoidWhen` 三個字串陣列。`avoidWhen` 至少一項，寫出具體不宜分流的情況。`executionClass` 可用 `deterministic`、`hybrid`、`unknown`。`maturity` 可用 `experimental`、`bounded`、`certified`、`legacy`、`unknown`。任一為 `unknown` 時須填 `unknownReason`。 |

每筆 `--knowhow` 與 `--compat-pin` 都要在同一次填卡中後接至少一個 `--anchor "檔:行:原文片段"`。引用相對於受查根目錄，原文須在該行或附近 ±3 行的唯一匹配中出現。直接填卡 JSON 可附 `anchors: [{file,line,expect}]` 或單筆 `anchor: {file,line,expect}`，也可重用卡上已核對過的錨點物件，產報告和匯出時會對來源重讀。路由可附錨點，沒附時報告標成路由建議。

`--knowhow` 與 `--compat-pin` 可多次追加。可用 `fix --remove knowhow:1` 或 `fix --remove compat-pin:1` 更正。一張卡只記一組路由，填卡成功時最後一筆路由取代原值。空的 `consumes` 或 `produces` 表示該路線沒有這類載體。若格式、已部署版本、重送或其他執行屬性尚未核實，請用既有 `--unknown` 記明原因。釘選與驗證欄記錄預期和檢查方法，實際結果另用 `--verify` 記錄。

### 小範例

以一個接受既有影片素材的外部剪輯工具為例。假設受查資料夾有這三行來源。

- `docs/materials.md:12` 有 `Keep the source ID and in/out for every clip.`
- `contracts/clip-schema.json:18` 有 `"required": ["assetId", "in", "out"]`，是 `compile_clip` 的已保存 MCP schema。
- `docs/clip-workflow.md:7` 有 `Edits supplied MP4 files and outputs an MP4.`

```sh
node scripts/trace.mjs fill --card ../card.json --step 2 --compat-pin 'mcp|compile_clip|輸入必填 assetId、in、out|唯讀查詢 compile_clip 的 live schema。必要欄位漂移就停下' --anchor 'contracts/clip-schema.json:18:required'
node scripts/trace.mjs fill --card ../card.json --step 6 --knowhow 'invariant|剪輯片段保留來源身分與有證據的起訖|工具以來源 ID 和 in/out 表示片段|逐段對凍結來源清冊與實際邊界' --anchor 'docs/materials.md:12:source ID and in/out' --routing '{"consumes":["mp4"],"produces":["mp4"],"executionClass":"unknown","maturity":"experimental","avoidWhen":["沒有可讀的影片來源","要求從純文字生成影片"],"unknownReason":"只有來源契約，未觀察實際執行路線"}' --anchor 'docs/clip-workflow.md:7:supplied MP4 files' --unknown '已部署引擎版本|not-run|未連線到執行中的引擎|已讀保存的 schema|在獲准範圍讀取引擎版本|隔離試跑|保存的契約只能說明舊快照|yes'
node scripts/trace.mjs report --card ../card.json --out ../report.html
node scripts/trace.mjs export-integrate --card ../card.json --out ../handoff.json
```

在 Windows PowerShell 5.1 可把同一個 JSON 物件存成 UTF-8 檔案。`--routing-file` 接受 `Out-File -Encoding utf8` 或 `Set-Content -Encoding utf8` 寫出的 BOM。路徑含空白時加引號，相對路徑以命令執行目錄為準，後續 `--anchor` 可直接接在檔案參數後。

```powershell
node scripts/trace.mjs fill --card ../card.json --step 6 --routing-file "../clip routing.json" --anchor "docs/clip-workflow.md:7:supplied MP4 files"
```

在 Windows PowerShell 5.1 使用內嵌的 `--routing` 時，以單引號包住 JSON，並將 JSON 的雙引號寫成 `\"`，例如 `'{\"consumes\":[\"mp4\"]}'`。

Markdown 鏈卡與 HTML 報告會顯示有填寫的章節。匯出重讀各新欄位的來源錨點，有無效欄位或錨點就拒絕產檔。輸出須在受查根目錄外，路徑須可寫且檔案尚未存在。

`handoff.json` 使用以下鍵值。

| 鍵 | 內容 |
| --- | --- |
| `schema` | `trace-integrate-handoff-v1` |
| `source` | `{ question, root, version }`，沿用卡片的受查位置與版本。執行版本未知時保留 `running: "UNKNOWN"` 及 `runningCause`。 |
| `knowhow` | `[{ kind, rule, toolDetail, verification, anchors }]` |
| `compatPins` | `[{ surface, target, expectation, probe, anchors }]` |
| `routing` | `{ consumes, produces, executionClass, maturity, avoidWhen, anchors }`，有填寫時包含 `unknownReason`。 |
| `unknowns` | 既有未知項目及其原因、下一步等欄位，每項加上 `status: "UNKNOWN"`。 |

錨點保留 `file`、`line`、`expect`、`sha256`、`status` 及適用的行號校正欄位。進度與 HTML 報告的摘要對相同的 `(file, line, expect)` 只計一次，每條主張仍保有自己的錨點。舊卡也可匯出，缺少的清單是 `[]`，缺少的路由是 `null`。交接供平台作者取用，權限相關決定和執行驗證仍以各自的證據為準。
