# 記錄普查與空 catch 掃描

## 適用範圍

供 SKILL.md 跑歪診斷流程的記錄層使用。普查器不執行目標程式、無網路、無 npm 相依，
只讀檔並把 JSON 印到 stdout。版本分組不是儀器存在證明；讀綁定實作才是第 0 步。
案例只在查該專案時讀取；本文件僅定義方法與格式。

## 普查器參數

`node scripts/record-census.mjs --config census-config.json`。設定與輸出放在授權的外部 TEMP。必填與選填如下：

| 參數 | 必填性 | 意義 |
|---|---|---|
| root | 必填 | 絕對記錄根，唯讀 |
| recordPattern | 必填 | 對 root 相對路徑比對的 regex，命中檔為 record marker |
| eventsDirectory | 必填 | 相對 record 目錄，只掃直接子檔 |
| eventFilePattern | 必填 | 事件檔名 regex |
| mode | 必填 | one-json-per-file 或 jsonl |
| typeKey | 必填 | 點分字串或 key 陣列 selector |
| recordVersion.keys | 選填 | 非空 selector 陣列，從 marker 取版本；優先於 binding |
| binding.relativePath / binding.key | 選填 | 若提供 binding，兩欄皆必填；相對路徑不得超出 root |
| codeBinding | 選填 | {head,dirty} 或 {versions:{版本:commit}}，不讀取當前 Git HEAD 代填 |
| crossFields | 選填 | selector 陣列；[] 或未給時 crossCounts=null、statisticsStatus.crossFields=UNKNOWN 並留 CROSS_FIELDS_UNKNOWN |
| crossType | 選填 | 只統計此型別；未給則統計全部型別 |
| trigger | 選填 | 非空 selector 對應值物件，所有條件嚴格相等；未給時觸發統計=null 並留 TRIGGER_UNKNOWN |
| excludeDirectories | 選填 | 目錄名排除陣列，預設空 |
| populations | 選填 | 母體目錄名對應標籤，不是用途證明 |
| retainEvents / classificationOutput | 選填 | 保留事件／綁定分類輸出，見下文 |

codeBinding 的 commit／head 需為 40 或 64 位十六進位字串，dirty 需為 boolean。版本對應表非空；單一版本欄位以其值的字串為 key，多欄位以 JSON.stringify(version) 為 key。未提供或版本未列在對應表時留 CODE_BINDING_UNKNOWN。只給 HEAD＋dirty 是當下程式快照的呼叫者聲明，historicalAssociation=UNKNOWN；不會指派給任何歷史記錄。所有綁定 verified=false，不代表已核對 commit 內容。
statisticsStatus 分別標記 crossFields／trigger 為 PASS 或 UNKNOWN；null 不可讀成 0。

marker 所在目錄為單一 job／record，發現後不再深入搜尋巢狀 record。
同目錄多個 marker 留 gap，仍只算一個 record。腳本不替呼叫者猜 marker。
不跟隨 symlink；發現、解析、欄位或綁定缺口逐項輸出。相同版本字串精確分組，
不以 basename 合併版本，也不宣稱字串相異就必然是不同位元組。
若 binding 是不可變 commit ID 而非 codeRoot，照樣分組；由呼叫者解決 ID → 程式來源。
recordVersion.keys 可從 marker 本身取多個版本欄位，標 versionSource: RECORDED；缺欄位保留 UNKNOWN，不回退到現行設定。
使用 binding 指向現行設定時標 CURRENT_BINDING_MUTABLE。不支援從每個 event 各取不同版本：
同 job 跨版本時應把 record 劃為可唯一綁定版本的執行單位，不用 job 當錯誤分母。

其他系統可使用 `recordPattern: "(?:^|/)record\\.json$"`、
`eventsDirectory: "logs"`、`eventFilePattern: "\\.jsonl$"`、
`mode: "jsonl"`、`typeKey: "event.kind"`、
`crossFields: ["actor.role", "action.name"]`、
`binding: {"relativePath":"meta/version.json","key":["build","revision"]}`。
讀真實格式後改參數，不需要改腳本。跨欄位 tuple 以 JSON 陣列編碼，
不以冒號拼接，以免欄位值本來有冒號而混淆。

## 先讀輸出，再作推論

輸出先列 typeCounts；key 為 JSON scalar 編碼，故 read 型別的 key 是帶引號的字串。
缺型別以 UNKNOWN bucket 與 gap 標記；crossCounts 的缺欄位用 null 加 gap。
totals 包含 records、eventFiles、parsedEvents、triggerEvents、
recordsWithTrigger、knownVersionsWithTrigger、unknownVersionRecordsWithTrigger。
versions 列每個版本的相同分母及統計；jobs 列來源 marker、binding 路徑、
binding SHA-256 與每個 job 的事件／觸發次數，供回查及版本子集篩選。
沒有任何可解析事件或找不到 record 時一定留 gap，不會輸出「機制從未執行」。

exit 0 表示普查完成，gaps 空或僅含 CROSS_FIELDS_UNKNOWN；其他 gap 為 exit 2（stdout 仍保留量測）；
exit 1 表示輸入／程式層失敗。成功執行不等於業務機制正確。
同一驗收項目連續失敗兩次就停止，不刪失敗證據，不改輸入迎合歷史數字。

每個 JSON 物件計一次；不自動去除重試或重複事件。JSONL 空白行略過，
壞行有檔名與行號，不影響其他有效行的保留。未知或不完整分母不能宣稱真實總量。
事件目錄以外的 knowledge-events.jsonl、attention 與 read-coverage 產出不在
預設普查分母；要檢查產出須另外只讀那些檔，不能從 typeCounts 缺席推定零產出。

## 第 0 步與儀器條件的手動查證

1. 以 jobs 的 binding 路徑、key、值與 hash 固定本次讀回證據。
2. 對 versions 中每個有觸發的已知版本，讀其真正實作；記路徑、hash、
   writer／caller 行號、是否有儀器，並保留讀不到的版本為 UNKNOWN。
3. 以有儀器的版本篩選 jobs，重新加總對應 triggerEvents；
   若 writer 還要求 identity、turn、role 或尚無同 hash 檔，應逐條核對。
4. 只把可觀察且吻合完整條件的次數與同 job 的輸出對照。
   read 事件數可作線索，不能自行證明 finally 已進入或每次 read 應各產一個收據。

現在的 active-config 可能更新過；其 hash 只能綁定現在讀到的位元組。
缺乏不可變的歷史啟動記錄時，保留此限制，不把配置當作全歷史的獨立證明。
本次方法不新增人工決策等待；模糊處選保守預設並寫出其影響。

## 空 catch 掃描介面

`node scripts/scan-empty-catch.mjs --repo /absolute/read-only-repo`

用本機 Git 列 tracked JS／TS（js、mjs、cjs、jsx、ts、tsx）與 Python（py），唯讀 tokenize；
不載入受測模組。要求 git status --porcelain 起始為空並比對結束 status／HEAD。
JS／TS 的每筆 findings 有 file、line、kind、catchSource、swallowedOperation：
後者含完整 try 文字、起迄行、呼叫表達式及行號。writeRelated 是排序線索，
以函式名稱推測，既不是完整副作用分析，也不是是否寫成功的判準。
EMPTY_OR_COMMENT_ONLY 是空或只有註解；
RETURN_ONLY_REVIEW 包含 return 表達式，應查其函式是否記錄或重拋，
不能不讀上下文就把所有 return 候選叫做「無記錄」。
Python 只找 except 區塊只有 pass 或 ... 的候選，kind 是 PASS_ONLY_REVIEW 或 ELLIPSIS_ONLY_REVIEW；
這兩種沒有 swallowedOperation，也不判斷屬於哪個 try。不執行 Python。
多行 except 標頭、無法判定的 tab／空白混用、未結束的字串、空區塊與只有字串的區塊留 PYTHON_EXCEPT_UNKNOWN gap；
區塊裡有其他敘述就不是候選，也不留 gap。
其他原始碼副檔名列在 unscannedExtensions，並留 UNSUPPORTED_SOURCE_LANGUAGES gap，結果 PARTIAL；
一個支援的檔都沒掃到時，status 是 UNKNOWN 並留 NO_SOURCE_FILES gap，不是 PASS。
輸出清楚標「存在不等於有在吞」。

工具是詞法候選掃描，不是完整 AST；template literal 整段視為文字，插值不解析；
控制條件右括號後的 regex 與除法有歧義。無法配對或讀取的檔案列 gaps，
其他語言、untracked／ignored、catch 內先賦 fallback 的形式未涵蓋。
exit 0 表示此已揭露範圍完成，exit 2 表示有 gap，exit 1 為執行失敗。
需要完整其他語言覆蓋時另用適當工具，不把本工具的候選清單冒稱全語言完備分析。
對每筆候選讀 try/catch 與 caller；確認版本有儀器、觸發且無產出後才調查例外。
修復方向為保持原工作回傳／錯誤並留下 gap／limitation，查線本身不授權修改。

## UTF-8／LF 與保存

使用 [runner.md](runner.md) 的 Node UTF-8 介面：execFileSync(...,{encoding:'utf8'})，
fs.writeFileSync(...,'utf8')；中文不可經 PowerShell，僅傳 ASCII 編碼後的 payload。
TEMP/TMP 可固定為共同父目錄，clone 與 scratch 分開；詳見 runner。保存 stdout／stderr、exit code、argv，
寫完全文讀回相等並數 CJK、問號、U+FFFD、CR；問號可能是正常語法。
輸出與測試 fixture 只寫已授權位置，不寫被查 repo、runtime 或真實記錄根。

## 記錄母體（v2）

先列 root 下的直接子目錄 populationInventory，再發現 record。以第一個相對路徑元件分組，populations 配置只提供該目錄的分類標籤，例如 {"production":"REAL_USE","checks":"CHECK_REPLAY"}。未指定標籤是 UNKNOWN，不從名稱自動判定真實使用。populationInventory 包含零筆記錄的母體；populations 分別列 record、event、trigger 數。versions 以母體＋版本分組；jobs 也帶 population。totals、頂層 typeCounts／crossCounts 是 ALL_POPULATIONS 合計，不得稱真實。單一母體可從 versions 同母體項目取得型別分布。retainEvents:true 可保留事件物件及檔案／JSONL 行號供骨架工具使用。

## 記錄版本與分類輸出

recordVersion: {"keys":["basis.config","basis.core"]} 優先於 binding；按記錄自身的值分組，保留 marker SHA-256。
classificationOutput 指向 classify-records 的完整 JSON。工具核對每個 marker 都有分類且內容 hash 相符，才標 CLASSIFIED 並指向該輸出。
未提供時即使 populations 標籤叫 REAL_USE，contract 仍為 NAME_ONLY_UNVERIFIED；目錄是定位，不能代替用途證據。

## classify-records.mjs

records:{root,pattern} 宣告 record JSON 母體；filter 篩欄位，idKey 預設 id。
stores 的每項可用 root／roots 與 pattern，或相對每筆 record 目錄的 path／file。僅讀 regular file，不跟 symlink。
classes:[{name,when}] 明列類別，不使用優先命中；全部規則評估後多類別成立為 AMBIGUOUS、無成立為 UNKNOWN。
條件可組 all、any、not；原子條件 {key,op,value} 的 op 為 eq、prefix、regex、exists，elements:any 逐陣列元素比對。
join:{store,on:[{record,foreign}],where} 要求 on 每一對 scalar 嚴格相等，缺 key 不匹配；where 評估匹配的另一 store 記錄。
existsIn:{store,where} 查每筆記錄對應的事件／產物。每個判定保存檔案、key、實值與規則結果；不把缺失當 false 的外部事實。
來源讀取缺口保留 gaps，輸出 PARTIAL；沒有選到任何記錄時 status 是 UNKNOWN，並留 NO_RECORDS gap，exit 2；UNKNOWN 不當作零次使用。互斥政策必須明寫在 when，不靠工具暗中排序。

## 1.3.0

- G23：Python tab 依八欄對齊掃描 pass／ellipsis except；混用空白導致縮排歧義時留附原因的 PYTHON_EXCEPT_UNKNOWN。
- G07：crossFields:[] 與未提供同樣停用交叉統計；相關值為 null／UNKNOWN 並留 CROSS_FIELDS_UNKNOWN，僅此 gap 時 CLI exit 0。

## 1.4.0

未提供 binding／recordVersion 也能完成普查；版本保持 UNKNOWN，輸出 PARTIAL 與 CODE_BINDING_UNKNOWN，沿用 PARTIAL exit 2。 未給版本欄位時每筆加 RECORDED_VERSION_UNKNOWN，versionSource 為 UNKNOWN；不拿目前 HEAD 補歷史版本。缺 binding 與不合法 binding 分開：後者仍為配置錯誤 exit 1。
