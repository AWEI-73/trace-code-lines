# 一次呼叫完成整輪查線

先用 `audit.mjs --init <repo> --out <config>` 產生骨架，補 questions 與授權的 recordRoots，再用 `audit.mjs --config <config>` 一次跑完。完整設定範例、預設上限與欄位定義見[英文對照](audit.en.md)。

## 輸入

- repo：原 repo 只讀；選填 pins.head 與 pins.files[{path,sha256}] 固定版本。
- questions[]：每題 id、ask；選填 anchors、tests、records、deletePaths。錨點支援 file#literalSymbol 或 {file,symbol,line,expect}，只驗字面位置，不自動代替語意判讀。
- recordRoots[]：明示 label、path，只讀。init 只列 repo 內目錄與 JSON 設定明寫的路徑候選，不追讀外部候選，不猜磁碟。
- writeRoot：結果與隔離執行根，不得和來源、紀錄根重疊；不覆寫既有 audit 產物。
- mapRoots[]：接受 repo 相對路徑字串，或 `{path,reason?}`；先取題目必需根，再以剩餘名額納入這些根。不存在、非相對路徑或不在有界來源內的根會列入 mapDiagnostics.gaps。
- limits：正整數上限；缺省值包含 6 GiB 空間底線。逐母體限制檔數與 bytes，逐題限制測試數，逐程序限時。

## 編排與證據

沿用 discover-entries、version-chain、derive-map、record-census、deletion-impact、run-once與 report。init 填好候選與既有測試清單；詳細版本鏈可用 versionChain 明示原工具設定，不把 current 候選當已綁定的歷史版本。

records 依 root label 選母體，files 為精確相對檔名；未填則讀有界範圍的 JSON/JSONL。自動辨識整份 JSON、array 或 JSONL，正規化到輸出根後交 record-census 依 kindField（預設 kind）分組。fields 交叉統計，trigger 或 kind 明示觸發條件；items 選 JSON 內陣列。metrics 支援 value、length、sum、distinct，每值附 file、selector，不重寫領域計票與資格計算。快照不去重成真實執行次數。

tests 只跑明列的既有 Node 測試檔；其他語言與 runner 留 UNKNOWN。每檔獨立複製 Git tracked 母體、校對 hash，以既有儀器禁網路、清帳密、只允許本 Node，用隔離 HOME/TEMP執行。不安裝依賴、不啟動模型；保留收據與逐字輸出後移除測試副本。API hook 不是 OS 沙箱，原生程式、worker thread、脱離程序仍有觀測限制。

## 一張卡與判定

audit.md 加 audit.json；每題附 PASS、FAIL、只存在沒觸發或 UNKNOWN，並列錨點、指令、exit code、母體、缺口與下一步。直接呼叫既有函式時 exitCode=null，另列 resultStatus，不假造程序退出碼。run-* 保留完整中間證據。report 透過 testEvidence:{path,sha256} 接同輪測試 bundle，從逐字輸出重算分類，新增失敗章節，不改既有靜態判定與計數。

PASS 只表示指定測試斷言通過；FAIL 為實測失敗，另列環境拒絕。錨點存在且明示觸發條件在完整留存母體為零，才能標只存在沒觸發；不是全域沒人用。只有靜態、缺根、缺執行綁定、刪除相容性、不完整執行與無斷言的 exit 0 皆留 UNKNOWN。證據等級：真實使用 > AGENT_DRIVEN_STUBBED > 測試跑過 > 只有靜態。留存紀錄另標歷史綁定 UNKNOWN，不自動升為現版真實使用。

上限超出會列被略過的問題、測試、紀錄與掃描剩餘範圍；來源不完整時不用半份副本跑測試或 map。版本、來源或紀錄完整性不符就停止；缺記錄根則回 UNKNOWN。整輪完成可以包含 FAIL/UNKNOWN，CLI exit 0 只代表編排完成。

Markdown 每題與每個紀錄區最多顯示 20 筆缺口，列明省略數；JSON 保留全部。刪除題另列路徑在來源快照是否存在、repo 與留存引用的代表錨點。

## 1.23.1 刪除題

deletePaths、anchors 的檔與 tests 先全部納入 map 根，即使超過 maxMapRoots；只用剩餘名額納入其他入口。mapSelection 與 skipped 列完整略過路徑；init 保留全部候選。

同輪 derive-map 以 importTargets 追加 incomingImports，用既有解析器掃描可讀的 Git tracked JS/TS 與 Python 檔，找出向前閉包外的直接 import；不執行目標碼。保留 scannedFiles、edges、gaps 與範圍，由同輪來源 hash 與讀回綁定。相對路徑、省略副檔名、index、字面動態 import 與 require 沿用 map 解析；計算式、別名、不存在的目標與既有詞法限制仍需判讀。

每個 deletePath 的 imports 合併閉包與 incomingImports 的邊，去除重複位置，以 isTest 區分測試；Markdown 全列「程式 import」與「測試 import」的檔:行。importEvidence 附同輪 map 路徑與 SHA-256、掃描檔數與缺口數；缺邊明列 NO_MAP_EDGE，缺 map 列 MAP_UNAVAILABLE，不默默只回字串。stringReferences 排除已對到的 import 字面路徑區間；原 repo 引用與判定保留。

每題開頭列「被 N 個程式 import、N 處字串引用、N 個測試、留存物 N 檔」。deletion.summary 的 programImports 計非測試呼叫檔；stringReferences 計 repo 完整路徑字串次數；tests 計 import、字串或題目指定且在快照的測試檔；retainedFiles 計留存根/檔名。跨目標的檔數去重，字串依各目標計次；逐目標 summary 不含只由題目指定的測試。不完整母體的數字只是已觀測值；JSON 保留全量。

單獨 deletion-impact 仍只掃完整路徑字串；合併 import 用 audit。缺邊不等於沒人用，刪除相容性仍留 UNKNOWN，不推論可刪。

只指定 symbol 的錨點解出來源檔後，也必須成為題目根。被 maxQuestions 略過的刪除題仍列數字摘要，但 summaryStatus=NOT_RUN；零只表示未觀測，不是零依賴。

## 1.24.0 依賴圖診斷

卡片的 mapDiagnostics 與 Markdown「依賴圖診斷」列出本輪是否產圖、來源檔數與 bytes、選入根、實際上限、阻擋檔案與補法。來源超出預算時仍停止 map 與測試，不用半份來源放寬驗收。SOURCE_BUDGET 每檔附 bytes 與各項超限的 name、limit、observed；DIRTY_SOURCE 保留 Git porcelain；無有效根列 NO_SELECTED_MAP_ROOTS；derive-map 未成功則列 DERIVE_MAP_FAILED 與原指令、exit code、stderr、error。Markdown 最多顯示 20 筆 map 缺口並列省略數，JSON 保留全量。

例如設定 `maxFileBytes: 2097152`，但 Git tracked 字型有 16,851,596 bytes，就會阻擋整輪 map，即使 mapRoots 與錨點都有值。確認授權母體與空間後，可在新的設定副本把 `limits.maxFileBytes` 提高至 33554432；亦須確認 maxFiles、maxTotalBytes 足夠，並使用新的 writeRoot 重跑。工作樹髒污則需先保存並檢視改動，選用獲授權的乾淨 checkout；缺根則補 repo 相對路徑的 mapRoots 或可解析題目錨點。不能用移除來源完整性 gate 代替補足證據。

產圖成功後，mapDiagnostics.artifact 保存同輪讀回的 `{path,sha256}`，readOnly 保存 map 的完整性證據；PASS 與 SAME_RUN_MAP_READBACK 僅表示這份 map 通過 repo／HEAD／readOnly 綁定，不代表執行過、功能正確或題目通過。既有題目判決規則維持不變；只有錨點與靜態圖仍可能是 INSUFFICIENT_MACHINE_EXECUTION_EVIDENCE。

init 若因檔數或 bytes 上限而未執行 discover-entries，discovery.status 會是 SKIPPED、reason 為 INCOMPLETE_DISCOVERY_POPULATION，blockedBy 列阻擋檔與觀測值。此時 entries 或 mapRoots 為空不能用來判定不認得某種註冊語法。可更新產出的 limits 並填入明示的 anchors／mapRoots 後執行 audit；若要重做候選探索，可呼叫既有 `initAudit(repo,newConfig,{limits})` 並使用新的設定檔名。

外部收據沿用已授權 recordRoots 與題目 records；若保存的是 `{name,args,result}` 陣列，可用 `kindField: "name"`、`fields: ["name", "args.projectPath"]`、`trigger: {"name":"render_project"}` 做留存統計。selector 不會再解析 `result.content[].text` 裡的 JSON 字串，亦不由 module／artifact hash 推定原碼 commit；沒有歷史綁定就保留 UNKNOWN。接入留存紀錄不會自動升格為現版真實使用或 PASS。
