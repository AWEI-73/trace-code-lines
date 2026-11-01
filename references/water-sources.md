# 水源、通用卷帶與機器判決

`water-source.mjs --config scenarios.json --enable` 執行已授權的隔離試跑；省略 --enable 只列計畫。工具只觀察，不替 agent 決定情境。入口清冊包含 CLI、web route、export、SKILL 腳本、MCP、GAS API；agent 讀原碼後補參數，未支援的啟動方法寫 UNKNOWN，不漏列。

設定需有 source（existing、test-recording 或 agent-api）、clone、allowedRoot、outputRoot、scenarios。clone 與 outputRoot 必須在授權根下且彼此分離。既有紀錄的 records 每筆需 file 與 sha256；完整性不代表真實使用。既有卡帶可放進情境的 cassette 重播。

情境每筆包含 id、request（呼叫參數與用途）、prerequisites（先前情境 ID）、command（陣列，用 @NODE 與 @CLONE 代換）、expected、anchors；另可含 cassette、callOrder、timeoutMs。timeoutMs 預設 60000 毫秒，上限 300000 毫秒（五分鐘），超過會截至上限。執行器不跑 shell 字串。Python 透過副本內的 Node 啟動腳本呼叫，必須列入 pythonExecutables；原生工具需要另外確認邊界。

expected 支援 coverage 的 file、write 的 file 與可選 sha256、boundary 的 key 與 count、anchor 的 file/line/expect、status 的 path/value。每個情境至少有一個覆蓋、寫入或邊界錨點，只有 exit 0 或回傳文字不足以過關。

輸出按情境保存 attempt-1.json 到 attempt-3.json。agent 讀失敗結果後修改原計畫，再用相同 outputRoot 執行；已過情境不重跑，未過最多三次，所有計畫 hash 留存。不得另換 ID 或輸出目錄逃避次數限制。任一必要觀察未核對通過就 FAIL。前置失敗不執行後續步驟。

## 通用邊界卷帶

schema 為 boundary-cassette-v1，包含 anchors 與 calls。每筆 call：
- sequence：從 0 開始的順序。
- kind：subprocess、http、model-sdk。
- request：子程序用 executable/argv；HTTP 用 url/method/body；SDK 用 provider/method/input。
- key：cassette.mjs 的 requestKey(kind, request)。
- response：子程序 stdout/stderr/exitCode；HTTP body/status/headers；SDK 為固定回應物件。
- source：只能 stand-in、test-fixture、existing-recording；paid 可標 true，live 永遠 false。

模型 SDK 若使用 fetch 或 Node HTTP，直接攔在傳輸邊界；其他 SDK 必須從依賴注入點接 modelStub(provider, method, input)。不支援的傳輸拒絕或寫 UNKNOWN，不對真模型做探測。

重播先核對來源檔 hash 與錨點，並將 agent 從現行程式讀出的 callOrder 與卷帶逐步比對。缺順序寫 UNKNOWN，不執行；第一個不同步驟立刻 STALE。這是來源綁定與宣告順序檢查，無法靜態證明任意計算式的實際順序；執行時還會逐筆核對，錯序拒絕。舊式外部專用卷帶需要轉成此格式，不能未檢查直接長時間重播。

測試錄帶同樣使用此格式。試跑輸出的 cassette-N.json 記下實際消耗的替身邊界，並保留 V8/Python 覆蓋、API 邊界與寫入收據。它不是一次真服務採樣。

## 安全與結果

所有程序環境移除金鑰與 token；每次獨立 TEMP。付費服務不打真的，部署與登入命令在啟動前阻擋；沒有宣告的網路請求拒絕。已安裝依賴可從來源副本複製；需要安裝時只用鎖定檔，例如 npm ci --ignore-scripts，記錄 lock hash、下載來源與套件。安裝可連套件來源，試跑不准。

程序成功 processStatus 與回傳 status/state/ready/ok 分列；測試失敗逐筆分成環境拒絕與產品失敗並留原始判定文字。取消的測試另計，不把拒絕當產品錯誤。所有類別只涵蓋本輪觀測。

API 掛勾不是作業系統沙盒；Python audit 不能改寫子程序 argv，原生與未掛勾子程序不保證完整覆蓋。Windows 以已觀測 PID 清程序樹，再用 tasklist/netstat 查殘留；Linux 核對 /proc 的 TCP socket 與程序；macOS 使用 lsof。其他平台或缺工具、缺證據時保留 UNKNOWN。

即使錄帶沒有外部呼叫，也會綁定啟動腳本與預期覆蓋檔的來源錨點。每次嘗試保留計畫與來源指紋；清理程序與監聽埠缺證據時，情境不標通過。單次執行的 status 在只有程序成功時是 UNKNOWN，processStatus 才是程序結果。

## 報告大小與磁碟

water-source.json 的 `attempts` 只放摘要列：`attempt`、`status`、`reason`、`file`（attempt-N.json）與其 `sha256`。完整觀察只寫一次：情境本身的 `observation`；達上限而本身沒有觀察時，最後一個有觀察的 attempt 列保留它。大型情境不再因重複內嵌觀察而觸發 `RangeError: Invalid string length`。

命令參數中的 `@HOME` 換成隔離家目錄（`<temp>/home`），與 expected 檔案路徑相同。

`pruneRaw: true`（只刪覆蓋可用舊名 `pruneRawCoverage: true`）在覆蓋對應完成後刪除原始覆蓋檔，`observation.coverage.pruned` 記錄刪除檔數與位元組，`evidence[]` 仍保留每個原始檔的 SHA-256 與 `pruned: true`。`pruneRaw` 另在 attempt 判定後刪除該次執行的 events 目錄、instrument-collect.json、observation.result.json 與 observation.packed，`prunedRaw[]` 記錄路徑、檔數、位元組與內容 SHA-256；判定用的 events 仍在 attempt-N.json。預設不刪，需重新對應或重讀原始追蹤時不要開。

## 輸出證據與輸出判定

每次執行在 `observation.output` 記錄 `exitCode` 與 `stdout`／`stderr` 的 `{path,sha256,bytes,tail}`（tail 為最後 4000 位元組）。

expected 另可寫：

- `{kind:'output',stream?:'stdout'|'stderr',contains?|pattern?,flags?,absent?}`：文字包含或正則；`absent:true` 表示不可出現。
- `{kind:'json',source?:'stdout'|'stderr'|檔案,pointer,value?|exists?}`：整段或最後一行可解析的 JSON，以 RFC 6901 pointer 取值後比對；檔案可用 `@CLONE`、`@HOME`。
- `{kind:'exit',code}`：要求指定結束碼；有這項時不再另要求 0。

這三種都不算見證，仍需至少一個 coverage、write、boundary 或 anchor。

## 執行時解析的外部程式允許清單

`executables` 每項可為：

- 路徑字串：與原本相同。
- `{path,sha256}`：固定路徑並核對雜湊。
- `{configFile,pointer,sha256?,sha256Pointer?}`：每次執行前讀 JSON 設定檔，以 pointer 取程式路徑（相對路徑以設定檔目錄為基準），雜湊可直接給或由 `sha256Pointer` 取（可帶 `sha256:` 前綴）。

解析與核對發生在啟動前；結果寫入該 attempt 的 `executables[]`。設定檔讀不到、pointer 不存在、程式不存在或雜湊不符，該次 FAIL（`EXECUTABLE_*`），不啟動、不放寬。

## 安裝副本與多 repo 覆蓋

程式常先安裝到別處（例如 `@HOME/...`）再從副本執行，覆蓋落在 clone 外而不計入。設定：

- `pathMaps: [{id?, installedRoot | pattern, flags?, to?, repo?, verify?}]`：`installedRoot` 可用 `@HOME`、`@CLONE`、`@TEMP`；安裝位置每次不同（例如隨機暫存目錄）時改用 `pattern`，對以 `/` 分隔的絕對路徑比對，具名群組 `rel` 為相對路徑；覆蓋到的副本檔對回 `to/<相對路徑>`。預設 `verify:'sha256'`，副本與 repo 檔位元組相同才計入，列在 `coverage.mapped[]`（`verified:true`、`sha256`）；副本在對應前已刪除（例如隨暫存目錄清掉）時，改用該次執行寫入紀錄的 after SHA-256（`verifiedBy:'write-snapshot'`）。不同、repo 無此檔或副本與寫入紀錄都沒有，列 `coverage.mapMismatches[]`（`HASH_MISMATCH`／`REPO_FILE_MISSING`／`INSTALLED_FILE_GONE`），不計覆蓋。`verify:'none'` 只在無法比對時用，列為 `verified:false`。
- `repos: [{name, root}]`：其他 repo 的覆蓋列在 `coverage.repos[name]`，不混入主 repo；expected 寫 `{kind:'coverage',repo:name,file}`。`pathMaps` 加 `repo` 可對回其他 repo。

未設定時覆蓋結果與原本相同。靜態跨 repo 依賴方向仍用 boundary.mjs；本節只處理執行覆蓋。完整範例：examples/water-installed-copy.json。

## 只靠雜湊的白名單與情境 manifest（1.29.0）

harness 常被情境複製到每次不同的暫存目錄，路徑無法事先寫進 `executables`。可改寫：

- `{sha256, root?}`：任何被啟動的檔案，只要位元組 SHA-256 相符（且路徑符合 `root` glob，例如 `@TEMP/**`）就允許。
- `{manifest, pointer?, sha256 | sha256Pointer, root?}`：spawn 當下讀情境寫出的 JSON manifest，`pointer` 指到的路徑須等於被啟動的檔案；雜湊由設定給（`sha256`）或由 manifest 給（`sha256Pointer`，屬情境自報，結果列標 `scenario-manifest`）。

兩者都延到 spawn 時由 recorder 讀實際位元組核對，attempt 的 `executables[]` 記 `DEFERRED_TO_SPAWN`，process 事件記 `hashAllowlist`（`allowedBy: sha256 | manifest`、實際 SHA-256、root）。不符就照常 DENY，不放寬路徑白名單。範例：examples/water-hash-allowlist.json。

## 單行執行與啟動快照

`{kind:'line', file, line, repo?, expect?}` 以 V8 區塊覆蓋判斷該行是否執行（最內層範圍 count>0；Python 用逐行計數）。這是區塊粒度：同一區塊內的行一起算。recorder 啟動 node/python 子程序時記下腳本 SHA-256，副本事後被刪也可用 `verifiedBy: launch-snapshot` 核對 pathMaps；`to` 可寫 `$<群組名>` 引用 pattern 的具名群組。

## 工具開發模式（--tool-dev）

`node water-source.mjs --config c.json --enable --tool-dev`：只在修改本工具時使用。解除三次上限，但寫入 `dev-attempt-N.json`、`dev-run-N/` 與 `water-source.tool-dev.json`，報告 `status: NOT_COUNTED`、`countsTowardVerdict: false`、`label` 說明不計入；正式 attempt 檔不讀不寫，上限仍是三次。體檢卡收到這種報告只列 `toolDev` 警示，不改 runnability 與證據等級；maintenance 直接拒收（`TOOL_DEV_RESULTS_NOT_COUNTED`）。
