# 1.5.0 推論層與 gap 執行對帳

## 匯入推論

先用既有 derive-map 配置建立靜態地圖，再加 --inferred-edges。不執行受查程式，不沿推論邊擴張靜態閉包。

~~~text
node scripts/derive-map.mjs --config map-config.json --inferred-edges inferred.jsonl
~~~

接受 JSON 單筆物件或陣列；.jsonl 每行一筆。檔名為 repo 相對路徑（/ 分隔），行號從 1 開始。

~~~json
{"from":{"file":"src/registry.py","line":75},"to":{"file":"src/tool.py","function":"run"},"confidence":0.8,"evidence":"Source locator and inference rationale","verified":false}
~~~

from 必須精確匹配現有 gap 的檔案與行（包含合併 wrapper 的 callSites）。找不到列 unmatchedInferences；格式錯誤列 rejectedInferences，不中斷其他記錄。讀不到匯入檔仍是輸入錯誤。

每條推論邊保存 inferred:true、confidence、evidence、source.path、source.sha256。原 verified 只保存為 declaredVerified；不是執行證據。每個 gap、closure、endpointTable 的 inferredEdges 都與原本 edges／files／endpoints 分開。

counts.staticEdges 是各 closure 既有詞法邊筆數合計，可包含重疊根與空 targets；不是全部 ESM import 或函式呼叫的總數。counts.inferredEdges 為按身分去重後的推論邊數；重複宣告保留在 provenance。gaps 與 gapsWithInferences 以 gapId 跨 closure 去重。推論保存可對應的 gapIds，重複輸入不重複掛載。contract.sources 保存原碼及匯入檔 hash；純靜態快照 measuredAt:null，不捕捉執行時間。

## resolution 不取代 gap kind

- UNRESOLVABLE_STATICALLY：對 DYNAMIC_COMPUTED、REGISTRY_DISPATCH、FACTORY_DISPATCH、PYTHON_SYS_PATH_MUTATION、TEXT_REFERENCE_COMPUTED 加上此屬性，表示現行靜態解析器不能唯一求解，不是宣稱所有靜態方法都不可能求解。
- PROJECT_CONFIG_DEPENDENT：辨識到 uv run、poetry run、pipx run、npx、npm run 的子程序時保留 SUBPROCESS_TARGET_UNKNOWN 與 configHint。
- 其他缺檔、cwd/env、路徑或語法不明的 gap 保持原狀，不硬分類。

專案設定候選只讀 root 內受 Git 追蹤的 pyproject.toml / package.json。Python 支援 [project.scripts] / [tool.poetry.scripts] 的單行字面值；Node 支援 scripts / bin。名稱對上時列 configCandidates，candidate:true；只有確實存在的原碼檔列入 targets，其餘保留字面設定值與空 targets。不執行命令，不安裝，不解析巢狀 workspace、動態 TOML、shell 計算或依賴套件 bin。pipx/npx 實際可能使用其他環境，所以名稱相符也不能升格靜態邊。

## 執行對帳

~~~text
node scripts/gap-reconcile.mjs --config reconcile.json --summary gaps.md
~~~

~~~json
{"staticMap":"/evidence/map.json","coverageDirectory":"/evidence/coverage","observations":"/evidence/observations.jsonl","runId":"run-001"}
~~~

coverageDirectory 與 observations 至少一個；也可只用 instrumentCollect 指向 instrument-collect.json，從 hash 綁定 manifest 取 coverage 目錄。可沿用 coverage-reconcile 的 roots:[{root,prefix?}]；預設是地圖 repo。該輸入不需 endpointTable。

呼叫邊 observation JSONL 每行：

~~~json
{"from":{"file":"src/registry.py","line":75},"to":{"file":"src/tool.py","function":"run"},"runId":"run-001"}
{"from":{"file":"src/registry.py","line":80},"to":{"file":"src/other.py","function":"run"},"runId":"run-001","complete":true}
~~~

complete:true 是提供者對該 runId＋呼叫處的完整宣告：每次呼叫的目標都已記錄。工具不會自行推定完整。同處有多個 runId 時，只要任一次目標匹配即 VERIFIED；負面判定要求所有已提供的該處 runs 都完整。函式推論遇到同檔但未記函式的 observation，不做 REFUTED。有格式錯誤的 observation 時，停用可歸屬 run 的負面證明；無法歸屬時才保守停用所有負面證明，並保留 rejectedObservations。

| gap status | 意義 |
| --- | --- |
| VERIFIED | observation 在該呼叫處記錄到實際目標；可以沒有推論邊 |
| CO_OCCURRED | 該行與推論目標在同次執行有正覆蓋，不是邊的證據 |
| SITE_EXECUTED_TARGET_UNKNOWN | 該行有跑到，但沒有目標證據 |
| SITE_NOT_EXECUTED | 檔案有被量測，該行沒有跑到 |
| UNKNOWN | 沒有可用行證據、原碼不符、未量測或該語言沒有儀器 |

推論邊各自標 VERIFIED / REFUTED / CO_OCCURRED / NOT_OBSERVED。from 的檔名與行號、to 的檔名及選填 function 都要匹配才 VERIFIED。有不完整且不匹配的 observation 時採 NOT_OBSERVED。REFUTED 不刪除推論邊；只對提供的完整觀測範圍有效，不代表未來不會呼叫。

每份 coverage JSON 可附 runId。沒有 runId 時，單一目錄視為提供者宣告的同一次執行；不得混放多次或多版本。已標不同 runId 不交叉推定 CO_OCCURRED。V8 使用該行第一個非空白位置的最窄 range；同行多個呼叫或分支不能個別識別。Python settrace 沒有函式身分，指定 function 的推論不能只憑檔案行數升級。

合併 wrapper gap 保留原 line、callSites、codes、occurrences；siteExecuted 為任一已知呼叫處有執行，全部已量測且為零才 false，其餘 null。每條推論仍用自己的 from.line。結果 originalGap 保留原缺口與限制。

手寫示範的第一行必須明列 {"schema":"observation-header-v1","evidenceClass":"MANUAL_DEMONSTRATION","description":"Handwritten demonstration, not captured runtime edges"}。該資料集會保留 MANUAL_DEMONSTRATION 標籤，不能當成真實自動呼叫證據。純 coverage 的報告要另存。

CLI 成功讀取輸出 exit 0；有執行失敗或證據缺口時 PARTIAL / exit 2；輸入或完整性錯誤 exit 1。對帳 PASS 只是對帳完成，不是業務正確或所有 gap 已解除。

## 1.6.0 外部目標格式

下列為 to 物件；from、confidence、evidence 沿用既有格式。

~~~json
{"kind":"FILE","file":"src/tool.py","function":"run"}
{"kind":"EXTERNAL_BINARY","name":"uv","value":["uv","run","train"]}
{"kind":"EXTERNAL_PACKAGE","module":"vendor.model"}
{"kind":"PROJECT_SCRIPT","configFile":"pyproject.toml","name":"train"}
{"kind":"NO_FILE","description":"runtime object","value":"/outside/repo/object"}
{"module":"my_package.worker"}
~~~

無 kind 時沿用 FILE。無 file 且有 module 時，依配置 pythonSourceRoots（預設 [".","src"]）查受追蹤的 module.py / module/__init__.py；唯一命中轉 FILE，未命中或多重命中轉 EXTERNAL_PACKAGE，以 targetResolution 保存原因與候選。明確 EXTERNAL_PACKAGE 不自動轉 FILE。

counts.inferredEdgesByKind 分列五種目標。外部目標不允許 file，不讀取或追蹤外部路徑；所有推論都不擴張靜態閉包。verified:false 或未宣告時，declaredVerified:false 永遠保留；runtimeVerified 是獨立欄位。

## 1.6.0 observation value 與對應

~~~json
{"gapId":"gap-<id>","to":{"kind":"EXTERNAL_BINARY","name":"uv","value":["uv","run","train"]},"runId":"run-001"}
{"from":{"file":"src/registry.py","line":12},"to":{"kind":"EXTERNAL_PACKAGE","value":"vendor.model"},"runId":"run-001"}
{"gapId":"gap-<id>","to":{"kind":"NO_FILE","description":"runtime object","value":"/outside/repo/object"},"runId":"run-001","complete":true}
~~~

value 為非空字串或非空字串陣列。種類與識別欄位必須相同；推論指定 value 時需完全相同（argv 包含順序），不做 basename、大小寫或路徑正規化猜測。只提供 name 的推論只驗證執行檔身分，不宣稱驗證全部 argv。

EXTERNAL_BINARY 可由 value 的字串或 argv[0] 補 name；EXTERNAL_PACKAGE 可由字串 value 補 module；NO_FILE 可由字串 value 補 description。明確的 binary name / package module 與 value 衝突時拒絕該筆。PROJECT_SCRIPT 仍需 configFile 與 name。

使用既有 gapId 時 from 可省略；若同時提供 from，必須為該 gap 的呼叫行或同函式 import 行，衝突不對應。未指定 gapId 的 Python import 行，只在原碼 hash 一致、同一最內層函式，且目標唯一對上 REGISTRY_DISPATCH / FACTORY_DISPATCH / DYNAMIC_COMPUTED gap 的推論時對應。跨函式、模組層 import 或多義對應保持 NOT_OBSERVED。這是提供者的呼叫邊觀測，不是從 import 原碼推定實際呼叫。

REFUTED 仍需 complete:true；只有 import 行且無 gapId 時不作負面證明。缺少推論要求的 value / function 也不反證。外部目標沒有檔案覆蓋對應，coverage 不會讓它變 VERIFIED 或 CO_OCCURRED。

## 1.6.0 uv 代入與輸出

代入僅用於 PROJECT_CONFIG_DEPENDENT 判斷。同函式、呼叫前、直線層級單次指派的 list / tuple 可代入；uv 字面值與 shutil.which("uv") 可識別。計算值、重複指派、跨函式、條件指派、容器變動或傳給其他操作時保守留 gap。詞法掃描不是 Python 執行或完整 AST，不宣稱處理所有語法。uv sync / lock 沒有 script 名稱，configHint.name:null，只指向 pyproject.toml 設定。

~~~text
node scripts/gap-reconcile.mjs --config reconcile.json --out gaps.json --summary gaps.md
~~~

stdout 仍為完整 JSON，新增 outputs.result / outputs.summary 絕對路徑。未指定的輸出路徑為 null；不猜測 shell 重新導向的檔名。

## 1.7.0 缺口與匯入邊

- G38：FAIL：觸及需求單的連續失敗停損，已回復該項修改；設定 gap 及推論掛載仍可能重複，本包不是完整驗收通過版。
- G39：保留既有 code 與 cwd/env 缺口，detail 改為字串，原結構資料與字串 reason 保存於 data。
- G34：保留 run_crew 的變數名稱提示，新增 plot_flow 完整 if/else 分支代入；任一分支不可代入就維持原 gap。
- G40：uv run python 的程式碼與檔案模式標為直譯器，不查 project.scripts，保留環境未知。
- G41：推論 id 由來源位置、目標與種類計算，匯入及對帳依 id 去重，宣告 false 不會升級為 true。
- G42：可歸屬的拒收或壞行只停用所屬 run 的負向判定；無法歸屬時保守停用負向證明並明報。
- JS：在 preserved loop 只新增已解析 static-import 邊輸出，以來源、行號與目標去重，走訪內容不變。
- toolVersion：derive-map 從 SKILL.md 的版本欄位讀取工具版本，不在程式寫死。
- gap 欄位：共用正規化讓 gap 具有 line，整檔為 null，detail 為字串，結構資料保留在 data。

本版部分交付，G38 為 FAIL；既有誠實標籤與限制繼續適用。外部推論仍不擴張靜態閉包，coverage 最多 CO_OCCURRED。

推論身分不包含輸入檔路徑、記錄順序、信心分數或版本字串；首次從舊版來源位元組身分遷移會更換 id，既存舊 id 無法追溯保證一致。provenance 保存重複匯入的宣告與來源。對帳的 inferredEdges 與 inferredEdgeCounts 是按 id 去重後的母體；原 gap 與未驗證宣告保留。

JSONL 壞行若無可解析 runId，使用前方明示 run 區段；交錯執行紀錄應使用可解析且帶 runId 的行。無法歸屬的壞資料仍保守禁止負向證明。REFUTED 只適用 runtimeEvidence.completeRuns 列出的完整執行，不代表其他執行不可能發生。

分支解析只接受同函式且每個完整分支各自單次指派的簡單命令清單；缺 else、額外寫入、突變或不可代入分支仍保留原缺口。G38 停損後，設定提示仍是獨立 gap，使用者不可將其數量當成不同呼叫數。

## 1.9.0 legacyIds

gapId 公式自 1.8.0 起凍結：code + 相對 POSIX path + line + 遞迴排序 data。legacyIds 包含 1.5.0、1.6.0、1.7.0 舊公式的投影；原結構 detail 於正規化前計算，拆分 wrapper 使用舊合併代表。legacyId 值等於 legacyIds["1.7.0"]，保留一版。舊版解析行為若不同，公式投影不保證舊版實際曾輸出該 ID；真實對上率見交付證據。
