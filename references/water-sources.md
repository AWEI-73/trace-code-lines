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
