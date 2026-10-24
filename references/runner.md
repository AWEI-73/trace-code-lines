# 走訪器介面與限制

## 直接執行

需要本機 Node（本輪版本見驗收報告）與 Git，無 npm 相依。
先以 Node 在允許的 repo 外位置建立 temp 及 JSON config。
從 Node 用 execFileSync 啟動（不透過 shell 傳中文），下面命令只是方便識別：

```text
node /absolute/trace-code-lines/scripts/derive-map.mjs --config /absolute/config.json --calibrate-only
node /absolute/trace-code-lines/scripts/derive-map.mjs --config /absolute/config.json
```

程式只讀取 repo，輸出 JSON 到 stdout；不寫 repo，不 import 受測模組。
移除 --calibrate-only 才產生 roots、closures、zeroCoverageCandidates、populationStats。
校準失敗 exit 2 並省略閉包／候選；唯讀完整性失敗亦 exit 2。
輸入／Git／I/O 錯誤 exit 1。exit 0 只代表程序完成，還要讀 status、
calibration、每根 gaps 與 readOnly；UNCALIBRATED/PARTIAL 不能當校準 PASS。

## Config（JSON）

```json
{
  "repo": "/absolute/read-only-repo",
  "temp": "/absolute/external-temp",
  "protectedRoots": [
    "/absolute/other-repo",
    "/absolute/runtime"
  ],
  "roots": [
    {
      "path": "src/main.mjs",
      "reason": "package.json scripts.start; caller verifies source line"
    }
  ],
  "calibration": {
    "roots": [
      "src/calibrated.mjs"
    ],
    "baseline": {
      "path": "checks/known-closure.json",
      "selector": [
        "files"
      ],
      "entryKey": "path"
    }
  },
  "classification": {
    "rules": [
      {
        "name": "fixtures",
        "pattern": "(?:^|/)fixtures?(?:/|$)"
      },
      {
        "name": "tests",
        "pattern": "(?:^|/)tests?(?:/|$)|(?:^|/)test[_-]|\\.(?:test|spec)\\."
      },
      {
        "name": "docs",
        "pattern": "(?:^|/)docs?(?:/|$)|\\.(?:md|rst|txt)$",
        "flags": "i"
      },
      {
        "name": "source",
        "pattern": "\\.(?:mjs|cjs|js|ts|tsx|jsx|py|ps1|sh|c|h|cpp|rs|go|java)$",
        "flags": "i"
      }
    ],
    "fallback": "other"
  }
}
```

上面是配置形狀示例；用真實根與獨立基準替換，不能把示例當受測資料。

- repo/temp 必須存在且為絕對路徑；config.temp 必須等於既有程序 TEMP/TMP；工具不改程序環境。
  另可指定 scratch：固定 TEMP=X、repo=X/clone、scratch=X/scratch；兩個子目錄不得互相包含。
  scratch 預設 temp；scratch 與 repo/protectedRoots 任一方向重疊都拒絕。程序 TEMP/TMP 維持 X，不切換成 scratch。
  protectedRoots 由呼叫者提供其他 repo/runtime，並拒絕 symlink。
- roots 是非空陣列，元素可為相對路徑字串或 {path,reason}。
  字串形式只記 caller-selected root，正式根盤點宜用含定位的 reason。
  root 不在 tracked inventory 時會產生 gap，不會靜默跳過。
- calibration.roots 與業務 roots 可不同。baseline.path 可為 repo 相對檔或 repo 外絕對路徑；CLI --calibration <path> 可覆寫基準檔，
  selector 是逐層 JSON key 陣列；entryKey 指每列的路徑欄位。
  直接字串陣列可省 entryKey，根陣列在 JSON 頂層可省 selector。
  基準必須非空、不重複且為有界普通檔；記錄其 bytes hash。校準只比 missing／extra 路徑集合，gaps 另列 disclosedGaps，不使一致的集合校準失敗。
- 沒有獨立基準時 calibration=null，另給 uncalibratedReason。
  腳本不會自行產生「真實閉包」。未校準的一切候選標 PROVISIONAL_STATIC。
- classification 規則由 caller 提供，順序優先、互斥統計，fallback 必填。
  可加其他分類，但 source/tests/fixtures/docs 應分開；flags 不允許 g/y。
- config 本身與輸出也要放 repo 外。程式不代為建立或寫入輸出。
- commands 記錄實跑 Git argv；command 記 Node argv；configurationSha256 綁定配置。
  readOnly 記前後 status/HEAD、tracked 可讀檔雜湊差異及 unhashed 清單。

## UTF-8／LF 輸出

在 Node 腳本內處理中文；若啟動 shell 是 PowerShell，僅傳 ASCII 啟動命令或
把 UTF-8 原文轉為 ASCII hex/base64 後交 Node 解碼，不能貼中文字串到 shell。
使用以下模式保存每個輸出並讀回：

```js
const text = execFileSync(process.execPath,
  [runner,'--config',configPath,'--calibrate-only'],
  {encoding:'utf8',env:{...process.env,TEMP:temp,TMP:temp}});
const lf = text.replace(/\r\n?/g,'\n');
fs.writeFileSync(outputPath,lf,'utf8');
const back = fs.readFileSync(outputPath,'utf8');
if (back !== lf) throw Error('UTF-8 readback mismatch');
console.log({
  cjk:(back.match(/[\u3400-\u4dbf\u4e00-\u9fff]/gu)||[]).length,
  questionMarks:(back.match(/\?/g)||[]).length,
  replacementCharacters:(back.match(/\ufffd/g)||[]).length,
  cr:(back.match(/\r/g)||[]).length
});

```

失敗時同樣保留 e.status、e.stdout、e.stderr，不能丟棄失敗證據後重寫成成功。

## 沿用方法的能力上限

walker.mjs 保留 既有走訪器 的原 while 迴圈及 bounded-read/path helpers，
不在執行時依賴專案或歷史工作目錄。保留 CORE_PIN_* gap 名稱以維持來源對照，
它們是通用走訪診斷，不代表目標 repo 必須有特定專案的 pin。
既有走訪器 使用全部 tracked 檔的當前 hash 作 rows，本版沿用；before/after hash 不變
證明本次檔案未變，不能替代獨立基準。

解析支援 ESM import/re-export、module-relative JSON、CJS 相對 require 與 Python import。
CJS 與 Python 的精確範圍見 [language-support.md](language-support.md)；套件名列外部，不安裝依賴。
config.pythonSourceRoots 是 repo 內相對來源根陣列，預設 [".","src"]；順序有意義。
根須由 launcher、scripts、CI 或指令文件判斷，不能靠檔名推定實際使用。
closures 新增 edges 與 externalDependencies；每個 edge 保留 kind、來源行、specifier、targets。
Python 的動態字面載入及子程序候選保守納入閉包，計算式、cwd/env 與 sys.path 變更留 gap。
endpointTable 從閉包聯集掃描，逐列保留 roots、writer、line、operation、targetExpression 與 snippet。
這是候選表，completeInventory=false；resolvedEndpoint 未完成根綁定時為 UNKNOWN，不能當寫入證據。
非支援語言的根仍保留，但只保留根本身；不推論完整依賴。
每檔上限 8 MiB、每閉包 16 MiB；超限、symlink、非 regular file 留 gap。

self-test.mjs 包含原有回歸及 language-self-test.mjs 的 CJS／Python 合成案例。
Python 覆蓋測試需既有 Python 3，可用 TRACE_PYTHON 指定執行檔；不安裝套件。
只執行工具自建的合成字串，使用 -I -B -X utf8、sys.settrace；不執行受測專案。
它是回歸檢查，不是真實 repo 校準；失敗依需求單停損，不能用獨立檢查替整體改判。

## 1.2.0 輸出補充

- G12：child_process 字面腳本路徑成邊；join 尾段的所有符合檔都列為 candidate:true／TAIL_PATH_MATCH，不宣稱唯一解析，因為變數、cwd／env 仍未知。
- G05：保留全部 DB_MUTATION_CANDIDATE，增加 receiverHint 與分類計數；不採原提案的名稱白名單刪除，避免漏掉 uow 等別名。
- G13/G20：md／ps1／sh／yml／yaml 的 node／python／python -m／uv run 字面命令成 TEXT_REFERENCE；計算值留逐行 gap。
- G14：保留 status、calibration、confidence 分欄；補齊未校準的 walk／languageEdges／scan 標籤，不一律 provisional，避免蓋掉 CALIBRATED_STATIC。
- G21：map、census 及 map 內的 walk 階段進度印到 stderr；stdout 保持單一 JSON。
- G08：closures 每筆增加 root（等於 path），並在 runner 文件增加完整輸出範例。

上述文字入口是已支援的有限字面解析；只有一條邊都抽不出時才標 UNSUPPORTED_LANGUAGE_ROOT_ONLY。walk 是函式介面，沒有獨立 CLI；map CLI 以 progress callback 輸出其階段。

### 完整輸出格式範例

以下是單一空腳本根的完整格式示意，路徑與全零 hash 是明示佔位，不是實測或校準證據。

```json
{
  "schema": "trace-code-lines-v1",
  "repo": "/example/repo",
  "head": "0000000000000000000000000000000000000000",
  "temp": "/example/temp",
  "scratch": "/example/temp/scratch",
  "tmp": "/example/temp",
  "command": {
    "bin": "node",
    "args": [
      "derive-map.mjs",
      "--config",
      "/example/config.json"
    ]
  },
  "configurationSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "scope": {
    "population": "git tracked files",
    "parser": "Lexical ESM/JSON, CJS and Python",
    "pythonSourceRoots": [
      ".",
      "src"
    ],
    "completeRuntimeClosure": false,
    "referenceFunnelPerformed": false
  },
  "calibration": {
    "status": "PASS",
    "reason": "No independent baseline supplied"
  },
  "confidence": "PROVISIONAL_STATIC",
  "status": "UNCALIBRATED",
  "inventoryGaps": [],
  "limitations": [
    "Static file closure, not a function call graph or runtime execution proof.",
    "CJS relative file/package-main/index, Python source roots, TS extension substitution and tsconfig/jsconfig baseUrl/paths with repo-local relative extends are supported. Package extends, arbitrary aliases, bundler settings, namespace packages and runtime sys.path changes are not resolved.",
    "Regex matching can include comments/generated strings and can miss other syntax.",
    "Zero coverage candidates require the documented four-scope and template-family funnel.",
    "Unsupported-language entries are retained as roots; regex literals and unusual syntax may be misread; computed dependencies remain gaps except ordinary JS computed data reads, which are counted.",
    "Unreadable, linked or oversized inventory files are disclosed, never treated as absent."
  ],
  "roots": [
    {
      "path": "main.mjs",
      "reason": "caller-selected root"
    }
  ],
  "closures": [
    {
      "path": "main.mjs",
      "reason": "caller-selected root",
      "root": "main.mjs",
      "files": [
        "main.mjs"
      ],
      "gaps": [],
      "edges": [],
      "externalDependencies": [],
      "parserScope": "STATIC_LEXICAL"
    }
  ],
  "endpointTable": {
    "schema": "static-endpoints-v1",
    "layer": "static",
    "confidence": "PROVISIONAL_STATIC",
    "completeInventory": false,
    "endpoints": [],
    "receiverHintCounts": {
      "DB_LIKE_NAME": 0,
      "UNKNOWN_RECEIVER": 0,
      "LOCAL_CONTAINER": 0
    }
  },
  "zeroCoverageCandidates": [],
  "populationStats": {
    "source": {
      "total": 1,
      "covered": 1,
      "zeroCoverage": 0
    }
  },
  "readOnly": {
    "status": "PASS",
    "before": "",
    "after": "",
    "headBefore": "0000000000000000000000000000000000000000",
    "headAfter": "0000000000000000000000000000000000000000",
    "hashedFiles": 1,
    "changed": [],
    "unhashed": []
  },
  "commands": [
    {
      "bin": "git",
      "args": [
        "-C",
        "/example/repo",
        "rev-parse",
        "HEAD"
      ]
    },
    {
      "bin": "git",
      "args": [
        "-C",
        "/example/repo",
        "status",
        "--porcelain"
      ]
    },
    {
      "bin": "git",
      "args": [
        "-C",
        "/example/repo",
        "ls-files",
        "-z"
      ]
    },
    {
      "bin": "git",
      "args": [
        "-C",
        "/example/repo",
        "status",
        "--porcelain"
      ]
    },
    {
      "bin": "git",
      "args": [
        "-C",
        "/example/repo",
        "rev-parse",
        "HEAD"
      ]
    }
  ]
}
```

## 1.3.0

- G20：支援 Join-Path $PSScriptRoot 字面子路徑、-ChildPath 與兩段巢狀字面值，依腳本目錄解析；其他變數保留 gap。
- G14：修正零 gap 的完整地圖 status 為 PASS；calibration.status 仍為 UNCALIBRATED，confidence 仍為 PROVISIONAL_STATIC，不把走訪完成當獨立校準。
- G21：只快取同次 analyze 的檔案內容，結尾完整性核對重新讀磁碟；無跨執行磁碟快取。

有 gap 時 status=PARTIAL；校準失敗與完整性失敗仍保留 STOPPED 狀態。--calibrate-only 沒有獨立基準時仍為 UNKNOWN。

1.12.1：JS 讀檔規則見 SKILL.md。閉包新增 dataReadFiles 與 closureCounts.dataRead；DATA_READ 邊帶 resolvedFrom，程式碼目標接續既有 import walker，資料目標只記邊，缺失字面目標，以及帶程式碼字面線索或 executes:true 的計算式產生 DATA_READ_TARGET_UNKNOWN；其餘計算式讀檔只計 dataReadComputed，每根與總數均輸出，並附前 20 筆 dataReadComputedSamples（總樣本附 root）。總數累計各根呼叫次數，不做跨根去重。

### GAS and framework references (1.13.0)

Set "roots": "auto-gas" to trace all detected GAS entry files. A project built by concatenating modules can declare "gasScopes": [{"name":"server","files":["src/server/*.gs","src/server/*.mjs"]}]. Use an explicit roots array to keep your chosen roots unchanged while still listing gasEntryPoints. The config remains outside the read-only target repo.

gasAnalysis contains projects, scopes, edges and gaps for the tracked inventory. frameworkPathLoads contains inventory-wide framework edges and gaps. Closures contain only reachable edges/gaps. A missing file or computed framework value is a disclosed gap; a referenced file is never executed. Conventional source-export candidates are distinct from deployed globals. See SKILL.md 1.13.0 for lookup order and lexical limitations.

---
name: trace-code-lines
version: 1.13.0
description: 查線、依賴、孤兒候選、這條路線有沒有跑過或跑過幾次、到底哪份程式在跑、專案跑歪、功能蓋好卻沒動時使用。以版本讀回、記錄普查、一條路線補全、執行覆蓋與靜態終點對照診斷；一般寫碼、修 bug 或設計諮詢不觸發。
---

# 查程式碼線

交付可重跑的診斷與異常清單，區分四層：版本綁定、靜態依賴、保留記錄、執行覆蓋。
每個結論明寫「讀的是哪一層」、來源位置、時間、母體、版本與缺口。
查線不授權刪碼、修改受查 repo、部署、安裝工具或啟動真實工作。

## 跑歪診斷流程（最上層）

依問題選層後按順序進行，缺證據填 UNKNOWN，繼續獨立可做的層。

| 問題 | 必做層 | 延伸條件 |
|---|---|---|
| 版本、次數 | 0–3 | 無 trace 時第 4 層 UNKNOWN，不為走完流程新採樣 |
| 執行路線、覆蓋 | 0–4 | 先讀既有 trace；缺證據時依裝儀器條件採樣，需要閉包補第 5 層 |
| 依賴、靜態終點 | 0–3、5 | 第 4 層優先既有 trace；無採樣授權時 UNKNOWN |

第 4 步需要第 5 步的閉包／終點輸入時，先準備靜態清單，再回填對照；不可以空清單代替。

0. **版本鏈**：逐跳讀回「指標 → 設定 → 選擇器 → 程式根」，留下檔案、key、值與 hash。
   用 version-chain.mjs；來源 HEAD 不能代替實際執行版本；某跳不存在或未綁定就記 UNKNOWN，不推論。
   當前可變配置也不是不可變的歷史啟動證明。歷史記錄須依其版本分組。
1. **母體**：先列記錄根下的直接子目錄及分類依據，再數資料。
   用 classify-records.mjs 分類並附精確 join 證據；名稱只能標 NAME_ONLY_UNVERIFIED，衝突為 AMBIGUOUS。
   檔案母體另按 source／tests／fixtures／docs 分開，兩種分母不能互換。
2. **記錄普查**：先讀一個完整事件確定 JSON 物件或 JSONL，再跑型別、觸發及版本分布。
   每個數字附母體；合計只能稱合計。格式錯誤、缺檔、空分布都留下 gap，不能靜音跳過。
   用 record-census.mjs；用 route-skeletons.mjs 按母體整理事件骨架與版本次數。
3. **一條路線補全**：選最簡單且有資料的一條，逐 store 列 join 欄位、來源與目標定位。
   用 trace-one-job.mjs；先以 validate --config 驗證純 JSON，參照 [多 store 範本](../assets/trace-one-job.multi-store.json)；每個 join 回報 PASS／FAIL。
   recorded 欄位連結與 path convention 分開；先標記、不在單一斷點直接下缺陷判決。
4. **執行覆蓋**：用 coverage-reconcile.mjs 對既有 V8／Python trace 原檔、靜態閉包及終點表重算。
   至少一個 function 的 range count > 0 才算執行；頂層亦算，但具名函式另列。
   全部 count 為 0 的載入檔另標 loadedOnly，不說它執行過。
   報 (a) 閉包內執行、(b) 同母體閉包外執行、(c) 閉包內未觀測執行；外部依賴另列。
   Python 讀標準庫 sys.settrace 行計數；未提供該語言儀器時留 UNKNOWN，零覆蓋不代表永遠未使用。
   新採樣須另有明確授權且已確認零外部效果；只為完成診斷流程不構成採樣理由。
   即使有 clone，也先讀入口與子程序並核對所有寫入範圍。
   要裝依賴、要憑證／模型／網路、會寫正式資料或效果不明時，此層填 UNKNOWN；使用既有證據即可。
   writer 的精確 range 只證明寫入位置被走到；須配成功收據、前後檔案證據或新建隔離根清冊。
   檔案存在、模組被執行、種子還原、業務新寫入分開；暫存 rename 須有 writer 與最終檔佐證。
5. **靜態地圖與終點**：依下節校準、盤根、閉包與引用漏斗，列「根 → writer → 終點」。
   一個終點一個區塊，共用寫入終點列漏水點；只是共讀不算。
6. **異常清單**：本題所需層完成後一起評估。保留各層觀察、缺口與可能原因，禁止跨版本排除法。
   已確認正確版本有儀器、完整觸發條件成立而無產出，才支持缺陷判斷。
   版本無儀器、觸發不可觀測、記錄不完整都不能從零產出推定缺陷。
## 邊界與保存

- repo 預設唯讀；髒工作樹保留原狀，獲授權時 clone 到外部 TEMP，只分析提交版本並揭露差異。
  記錄前後 HEAD、status 與檔案 hash；本機 Git 使用 GIT_OPTIONAL_LOCKS=0。
- 輸出、config、TEMP/TMP 放授權位置，列 protectedRoots；不跟隨 symlink 或猜外部根；固定 TEMP 下的 clone／scratch 須互不包含。
- 模糊處選保守預設並記錄不確定性，不新增等待人工決定的步驟。
  同一驗收項目連續失敗兩次即停該項；不改基準迎合結果。
- 中文不經 PowerShell；Node execFileSync 使用 encoding:'utf8'，fs.writeFileSync 寫 UTF-8／LF。
  讀回全文相等並數 CJK、?、U+FFFD、CR；問號可為合法運算子。
- scripts 只用 Node 內建模組與 Python 標準庫；靜態工具不執行目標，儀器僅在授權採樣時執行。
## 靜態校準、盤根與引用漏斗

1. 讀真實 checkout 的獨立閉包基準，設定 calibration.roots 與 baseline。
   基準可放 repo 外，以 baseline.path 絕對路徑或 --calibration <path> 指定；工具記錄 SHA-256，不需修改受查 repo。
   校準只以 missing=[]、extra=[] 判 PASS；gaps 另列 disclosedGaps（已揭露缺口），不使集合一致的校準失敗。
   集合不一致時停止校準結論；無獨立基準時設 calibration:null，標 PROVISIONAL_STATIC。
2. 逐一讀 CI step、本機 action、package scripts／bin、排程、launcher、技能指令文件。
   根按「被當指令執行」判定，不按副檔名；保留 cwd、glob、包裝器、檔案與行號。
   不執行入口來找根。模糊入口保守納入，helper 排除須有證據。
3. 同 config 移除 --calibrate-only 跑逐根閉包。保留根理由、files、gaps、覆蓋聯集與檔案母體。
   函式層 caller／callee、定義行與呼叫關係目前手工補查；工具只交檔案層閉包，import 邊不證明函式被呼叫。
4. zeroCoverageCandidates 逐一補查：全 repo（含 hidden／ignored，排除 .git）、
   實際部署根、使用者技能根、已安裝快照，再查計算 URL／路徑模板家族。
   每層記命令、cwd、範圍、定位、exit code、排除與錯誤；未讀範圍 UNKNOWN。
5. 工具補出可解析的字面 dynamic import、子程序與 NODE_OPTIONS 的 --import／--require／--loader 引用候選。
   計算式、跨檔 env 傳遞與未支援旗標目前手工查證；自動輸出不代表已執行，也不代表引用漏斗完成。

七種引用證據是報告分類：STATIC_IMPORT、DYNAMIC_LITERAL、DYNAMIC_COMPUTED、
RUNTIME_FLAG_REFERENCE、SUBPROCESS_ARG、TEXT_REFERENCE_ONLY、NO_REFERENCE_FOUND_IN_DISCLOSED_SCOPE。
其中 TEXT_REFERENCE_ONLY、NO_REFERENCE_FOUND_IN_DISCLOSED_SCOPE 目前手工；工具的 TEXT_REFERENCE 是字面命令候選，不等於完整文字搜尋。
RUNTIME_FLAG_REFERENCE 的字面 NODE_OPTIONS 子集由工具產生，其餘旗標與傳遞鏈仍須手工核對。未查完四範圍漏斗只交候選，不能稱死碼或可刪除。
解析器支援詞法 ESM／CJS／JSON 與 Python import；1.12.0 補入 TS／TSX／JSX、.js 類副檔名替代與無副檔名解析。
tsconfig／jsconfig 支援 baseUrl、paths 萬用字元與 repo 內相對 extends；套件 extends 不載入，以 TS_RESOLUTION_UNSUPPORTED 揭露限制。
TS／TSX／JSX 的 parserScope 只有根檔實際產生已解析目標邊時才標 STATIC_LEXICAL；否則為 TS_RESOLUTION_UNSUPPORTED。這仍不是完整語意或執行證明。
詞法掃描不是 AST 或 runtime closure；alias、bundler、namespace package 及非字面執行期路徑仍有限制。

## 終點、儀器與交付

從 write／append／rename／資料庫 insert-update 的上下文列實際終點、路徑模板、
writer、讀者與來源行號；同名但不同根不是同一終點，計算目標未解析填 UNKNOWN。
零產出時先查產生資料的版本與完整觸發條件，再用 scan-empty-catch.mjs 查候選；
空 catch 存在不代表有吞例外，return 的被呼叫函式也可能已記錄。
不為診斷而移除 catch 或改受查 repo。

報告每層 PASS／FAIL／UNKNOWN，附可重跑命令、來源及產物；列保守預設、
解析限制、未覆蓋與前後唯讀證據。PASS 只對已完成的量測／校準，不等於功能正確。
貼紙需宣告、commit／根／終點、獨立基準、實跑檢查及失敗意義；唯讀任務只交提案。
新腳本與修改後跑 self-test.mjs；合成回歸不能代替真實 repo 校準。

## 裝儀器
問題需要執行證據且沒有既有 trace 時，讀 [儀器介面與限制](instrumentation.md)。
plan 預設只讀；run 必須明示 --enable。主動模式只在已授權的隔離 clone，寫入根須在 TEMP 或明列，網路 DENY、子程序 allowlist。
被動模式只記錄、從不 DENY；先取得 使用者 同意才換啟動命令，不改原啟動器或設定；未獲授權即保持原狀並記 UNKNOWN。
每次 collect 後必須 remove 並附 hash 拆除收據；修改過或未列冊檔案保留、殘留明報。儀器不是 OS 沙箱。
終點區分 WRITTEN_OBSERVED（寫入事件＋前後快照或業務值級收據變動＋writer 範圍）、RANGE_ONLY（僅範圍）、LOG_ONLY（缺靜態對應）；缺證據仍 UNKNOWN。

## 隔離跑一次與拆除試跑
已授權的新路徑採樣或候選拆除驗證，讀 [run-once／removal-trial](run-once.md)。替身結果只屬 RUN_ONCE_STUBBED，不是實際使用、業務驗收或刪除授權。

## 按需讀取
- [執行介面與靜態配置](runner.md)：derive-map、UTF-8 保存、解析限制。
- [語言支援與 Python 覆蓋](language-support.md)：解析順序、終點候選、trace schema 與限制。
- [記錄普查](record-census.md)：事件格式、母體、版本、空 catch。
- [路線與覆蓋配置](runtime-tools.md)：骨架、逐 join、V8、終點證據 schema。
- [引用查證](evidence.md)：七種證據、漏斗欄位與命令。
- [終點與貼紙](endpoints-stickers.md)：寫入區塊與宣告。
- [來源邊界](provenance.md)：方法來源與驗收限制。

## Branch selector and version identity

Use branches.items = deployments (a key in the earlier hop result), not a template string. Example:

~~~json
{"hops":[{"id":"deployments","file":"/snapshot/config.json","key":"deployments"}],"branches":[{"items":"deployments","hops":[{"id":"selected","file":"/snapshot/index.json","select":{"array":"items","where":{"id":"${item.id}"}},"key":"configSha256","valueType":"config-hash"}]}]}
~~~

Use valueType git-commit only for a source commit; config-hash and content-sha256 are different identities. HTML script src is supported; computed imports and bundler rules remain limitations.
