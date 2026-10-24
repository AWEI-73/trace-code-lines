# 隔離跑一次與拆除試跑

本功能僅在本次工作已授權隔離採樣時使用。預設不執行，指定 --enable 才啟動。
所有結果為 EXECUTION／RUN_ONCE_STUBBED；realUse 與 businessAcceptance 永遠為 false。
不把模型、外部 agent 或工廠內部納入追蹤；只保存交付邊界與回傳。

## run-once

```text
node scripts/run-once.mjs --config run-once.json
node scripts/run-once.mjs --config run-once.json --enable
```

配置：
- clone：已存在、獨立的受測複本；cwd 預設 clone。
- tempRoot：與 clone 互不包含的暫存目錄。
- isolationRoot：tempRoot 之下尚不存在的目錄；工具建立 HOME、USERPROFILE、APPDATA、LOCALAPPDATA。
- outputDirectory：tempRoot 之下新目錄，與 isolationRoot 互不包含。
- command：完整執行檔與 argv 陣列；目前首程序限 Node。Python 可由 Node 子程序啟動。
- resolvedWriteRoots：從目標實際解析的設定取得之寫入根，不得以原始設定文字代替解析後結果。
  工具在啟動前檢查所有宣告根只落在 clone、isolationRoot、tempRoot。解析動態設定仍由專案適配器負責；
  適配器須在進入業務操作前再次驗證並保存讀回，不能用空清單代替。
- configSources、discoveryFiles：讀回設定與靜態查找 CLI 分支的檔案；保留 hash 與檔案行號。
- executables、pythonExecutables、environment：沿用主動儀器；網路固定 deny，動態建立執行檔固定不放行。
  環境預設只繼承系統啟動所需名稱，再補明列 environment；不要帶入憑證。
- stopOnDeniedRoots：拒絕事件命中即通知控制程序停止本次程序樹；timeoutMs 為最長執行時間。
- boundaries：必填陣列；沒有外部邊界才可明列空陣列。

自帶 dry-run 以 discoveryFiles 中字面 CLI 分支辨識 --dry-run 或 plan，記錄來源行並先執行。
發現的命令仍套主動儀器與同組替身；找不到只記 NOT_FOUND_IN_DISCLOSED_FILES。
計算 CLI、別名、第三方命令解析器可能無法辨識；這個有限靜態掃描不證明不存在 dry-run。

## 替身宣告

每個替身具唯一 id、executable（完整路徑或名稱）、可選 argvPattern。
Node 非同步 spawn 接縫及同步 Proxy 於呼叫前改送本機替身；Python 使用明示 Node 邊界入口，
原執行檔不啟動。shell 字串仍拒絕。本節 boundaries 設定處理執行檔邊界；HTTP 與 model-sdk 的通用 cassette 另見 water-sources.md。未提供相應卷帶時，
未支援的網路路徑仍 DENY，不假裝已攔到完整 HTTP 請求。

回應優先順序：
1. replay：既有錄播的 stdout／stderr／value／exitCode；沒有真實錄播，不以此欄填手製成功樣本。
2. schema 或 type：產生最小值；僅支援程式列出的 JSON Schema 子集。
   不支援的 keyword、遞迴或無法滿足的限制回到宣告失敗，不能標成合法。
3. failure.exitCode／message：預設 70／BOUNDARY_STUB_FAILED；目標可繼續走自己的失敗處理。

inputPaths、snapshotDirectories 與 argv 中存在的檔案／目錄納入輸入。
完整 argv、cwd、stdin、檔案 bytes/base64/SHA-256、目錄檔案樹前後 hash、
env 名稱（不含值）、退出碼、耗時會進入 boundary-snapshot-v1。
snapshotCwd 可明列交付工作目錄；不要把整個使用者 home 當交付目錄。
不解析任意 prompt 中的路徑：由適配器將間接交付檔案補入 inputPaths。
schemaFileFlag 可從 argv 指向的 schema 檔讀取；outputFileFlag 指定回應文字檔。
rawString 可將字串型別原樣輸出。無 stdin 的 execFile 接縫要用 stdio: ignore；替身宣告 stdinMode: ignore，讓替身不等 EOF。若呼叫端可設定 spawn 的 stdio，也將 stdin 設為 ignore；execFile 的替身須靠 stdinMode 明確略過讀取。
outputArtifacts 可宣告 rootFlag 與 files[{path,schema|type|replay}]，限定在該根下產生檔案，
每一份產出仍經寫入政策檢查並記錄，不可用來寫真正的外部產物。

長連線 JSONL 可設定 protocol=jsonl 與 methods：
每個 method 使用相同回應選擇順序，schemaFrom 可指向請求中 schema 的點分路徑。
result／notifications 可使用整欄位模板 ${request.id}、${value}、${valueJson}；
sessionMode=caller 表示保持長連線直到呼叫端關閉 stdin；禁止方法設定 finish=true。
單輪模式才允許 finish=true；提早退出標記 DECLARED_EARLY_EXIT，不能歸咎產品故障。
每個程序有唯一 sessionId；模板另提供 ${sessionId}、${threadId}、${turnId}，thread/start 與每輪 ID 不重用。
協定握手用 schema.const 表達宣告，
不把合成握手標成錄播。未知 method 回傳 BOUNDARY_STUB_FAILED。
這不是任意 agent 協定模擬器；未宣告協定就觀察失敗路徑。

collect 完成後逐檔 gzip、讀回解壓核對 hash，再執行精確 remove。
result 連結壓縮索引、拆除收據、所有替身輸入與 DENY。
gzip 是二進位保存原始位元組；JSON／Markdown 交付使用 UTF-8、LF。
processStatus=PASS 表示受測命令 exit 0；此時整體 status 仍為 UNKNOWN，resultStatus 與 testClassification 另列回傳及測試狀態。失敗或命中受保護根的拒絕則為 FAIL。CLI 執行後只要整體不是 PASS 就回傳非零；上層 water-source 才依情境預期、觀測與清理結果作判決。不能把程序成功升格為業務驗收。

## removal-trial

```text
node scripts/removal-trial.mjs --config removal.json --enable
```

配置 sourceClone、trialsRoot、output、candidates（相對檔案路徑或含 path 的物件）、
validations（非空，每項 id 與 runOnce 配置）、maxTrials（預設 32，含基線）。
所有試驗在新複本進行；拒絕連結、目錄候選、越界路徑、重複候選與既有試驗根。
每次使用獨立 clone/home/state，避免上一組狀態污染下一組。驗證命令可含
${CLONE}、${TEMP}、${HOME}、${OUTPUT}，在本組環境展開。
Node API 的 evaluate 可包裝專案特定準備，但仍須使用主動儀器與相同隔離規則，
回傳 status、gaps、stderr／firstLocation、evidence；不能注入想要的 PASS。

先跑未移除基線；基線未過，不推論任何候選結果。之後整組移除、重跑完整驗證集，
失敗二分；每組都是獨立複本。命令非零或新增 gap 均不能通過。
- REMOVAL_TRIAL_PASS：全套驗證過且無新增 gap；附驗證集與試驗 ID。
- REMOVAL_TRIAL_BREAKS：單一候選失敗；附第一個失敗驗證與檔案／行號。
  若 stderr 無來源座標，locationStatus=UNKNOWN，不捏造定位。
- NOT_TRIED：預算用盡、基線失敗或尚未試到。

只能寫「在揭露的驗證集下拆除試跑通過」。驗證集外的隱藏引用、部署入口、
平台分支與真實模型行為仍未知；通過不授權刪除原件。
保留候選原始分類、搜尋時間與範圍；跨版本缺口不可消失。

## 已知證據界線

沿用儀器的 API hook 限制：不是 OS 沙箱；原生程式、直接 syscall、刻意移除 hook、
worker_threads 與檔案競態沒有完整覆蓋。明列執行檔的內部寫入不等於已受控。
因此先靜態檢查適配器、只允許必要工具，外部 agent／工廠一律以替身處理。
歷史試跑的成敗只適用當時版本；本複本的測試結果應讀對應 stdout、stderr 與 exit code，不能沿用舊版認證。

## 值級收據與工作階段

每次被 hook 觀測的成功檔案操作附 value-receipt：path、beforeSha256、sha256、changed、writeClass、fields。
valueReceipts 宣告 targetPattern 與 fields[{field,selector}]；name[] 展開為 name[0] 等具體 selector。
寫後讀回 JSON 值與 hash 同屬同一份 bytes；讀不到或非 JSON 不補值，NO_FILE_VALUE 留缺口。
writeClass 只接受 preparation、seed、business、unknown；以 TRACE_WRITE_CLASS 標記當下階段，子程序繼承。
只有 business、completeContent=true、changed=true 的收據可參與狀態升級，還須配寫入事件及正值 writer 範圍。
準備與種子可以保存收據，但不能充作業務狀態。open 成功不代表完整寫完，原生 fd、FileHandle、Python audit 的中間值仍 UNKNOWN。
寫後 readback 與並行寫入間仍有競態，不能視為交易式儲存證明；JSON 收據也不涵蓋資料庫內部。

替身先持久化 received，再讀 stdin；state 區分 WAITING_INPUT、RESPONDED、FORCED_TERMINATION。
Windows 強制終止不能靠子程序 exit handler；父程序保留 childPid、退出碼與 signal，collect 合併最近檢查點。
整棵程序樹被強制終止且沒有父程序退出事件時，terminationStatus 為 UNKNOWN_NO_FINAL_RECEIPT；不可聲稱已回應或產品故障。

## 執行檔替身與前提

| 邊界 | 可做的隔離觀測 | 缺失時的判定 |
| --- | --- | --- |
| 已到達 spawn／execFile 的模型或工廠執行檔 | 以宣告 schema 或失敗替身保存輸入與回應 | RUN_ONCE_STUBBED |
| 輸入型別、來源名稱、前序工作或輸出綁定 | 先提供合法隔離輸入，核對來源 hash 與回傳產物關係 | INPUT_OR_ARTIFACT_BINDING_UNAVAILABLE |
| 安裝 inventory、工廠環境、依賴與 grant | 只能讀回真實配置；替身無法代替進入前檢查 | FACTORY_PREREQUISITE_UNAVAILABLE |

可審核範例：[隔離設定](../assets/run-once-isolation.json)。先展開 CLONE、RUN_TEMP、NODE，保存解析值與 hash；clone 與 RUN_TEMP 互不包含。
外部讀取根保持唯讀，所有業務寫入須落在 RUN_TEMP；儀器網路 deny、allowCreatedExecutables=false，僅放行列明 Node。
範例以宣告失敗封住外部工廠，不偽造可交付產物。替身不准偽造安裝完整性，也不准擴張權限。
不可為通過預檢編造 inventory／grant 或把桌面、網路、模型加入 allowlist。原生工具寫入不能完整受 hook 約束時保留 UNKNOWN。

## 1.2.0 移除試驗的引用者

移除試驗列 tracked 檔中的字面引用者；未被驗證集涵蓋者使成功試驗降為 WEAK_VALIDATION_SET，不增加刪除授權。

knownReferrers 保留 path、line、literal、coveredBy。驗證的 coveredFiles 可明列相對檔名；否則只將 runOnce.command 中的直接腳本路徑視為已宣告涵蓋。這是驗證集的聲明，不是執行覆蓋證明。無 Git tracked 清單或讀檔失敗時 referrerScan.status=UNKNOWN 並留 gaps；不能以空清單推論沒有引用者。

## 1.3.0

拆除試驗納入 Python 絕對、相對與套件 import 引用者；未解動態 import 且驗證集未涵蓋時標 WEAK_VALIDATION_SET。
對未解 import 的保守關聯會標 candidate:true 與 UNRESOLVED_PYTHON_IMPORT，不宣稱已確認它指向某個檔案。
