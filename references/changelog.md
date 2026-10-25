# 版本記錄

## 1.19.0（2026-10-26）

- derive-map 保持 stdout 純 JSON、進度走 stderr，新增 --out 完整地圖與精簡收據。
- 新增 reach：反查入口、直接 importer、名稱使用與回退提示；舊地圖版本不符降 UNKNOWN，不代為決策。
- TEMP 不一致錯誤附 config.temp、process TEMP、process TMP。
- 擴充既有 self-test；公開包不含真實校準地圖或案例。

## 1.18.0（2026-10-25）

- 宣告對照新增可選阻擋點檢查：JS／TS／Python 終止、拒絕狀態與單跳同檔 wrapper 候選，保存行、symbol、片段 hash、訊息與 reason code。
- 提供政策原文錨點及 reason／關鍵字表，逐位置分底線、要處理、不確定；無宣告只列清單，防呆、混合條件與可能被接住的例外保留缺口。
- 整合維修單、health HTML／JSON 與體檢卡；沿用地圖與綁定水源，保留靜態可達與站點觀測的區別，不增加壞了的判定。
- 新增合成回歸檢查；公開包不含真實校準案例、參考答案或私人輸出。

## 1.17.3（2026-10-25）

- README 改為完整英文在前、完整繁體中文在後；開頭說明不把描述當成功、證據分級、隔離替身試跑與給人看的維修單。
- 補齊差異、Claude Code 與 Codex 安裝、使用方式、產出、邊界、語言限制及 MIT 授權說明。
- 新增合成範例維修單、技能自查體檢卡與合成範例路線圖截圖；公開包只包含截圖，不包含範例專案或原始試跑紀錄。
- 本版僅更新文件與截圖；scripts 與 1.17.2 逐位元組相同，SKILL.md 僅更新版本號。

## 1.17.2（2026-10-24）

- 私人來源啟發的測試改為合成圖書借閱題材，保留語法形狀與斷言意圖，來源標示改為合成案例。
- 新增 MIT 授權與第三方片段說明；整理 README、公開文件用語與歷史標題層級。
- 使用本工具檢查自身的靜態地圖、維修單、測試錄帶與宣告對照；本輪文件修正及未解限制見版本說明。

## 1.17.1（2026-10-24）

- 產品測試與情境失敗獨立列為壞了，依最早位置、具體訊息／錯誤碼或被拒絕 action 合併；環境拒絕另列。
- 經引用位置核對的原始 broken 直接保留故障，列出缺少目標、引用者、入口閉包與驗證方法。
- 完整試跑記錄集中到內容定址 evidence 檔；主報告只保留維修單與穩定參照，避免重複 TAP。
- 重跑指令保留真正引號、repo 相對路徑與明列前置條件；原始執行路徑留在已標示的證據記錄。
- HTML 插入使用函式回傳，避免測試名稱中的字串替換符號重複插入舊報告。規則與限制見 maintenance.md。

## 1.17.0 — 2026-10-24

- 健檢主畫面改為維修單；HTML 與 Markdown 共用原因合併、排序和判定模型，舊資料保留於展開區與 JSON。
- 每件由讀碼者提交白話標記與來源錨點；缺錨點、文字不符、缺意圖／成功試跑佐證時降為不確定。
- 接入 1.16 水源的原始覆蓋、寫入收據與測試結果；只以原因位置所屬檔案判定執行狀態，修法的命令只來自真的涵蓋相關檔案的測試。
- 新增規則參考文件；現有自測加入合併、降級、覆蓋歸屬與主畫面檢查。靜態地圖、流程圖、路線圖與體檢卡介面不變。

## 1.16.1 (2026-10-24)

- 非 Windows 以 process.kill(pid, 0) 核對殘留程序。Linux 比對 TCP/TCP6 監聽 socket inode 與程序檔案描述符；macOS 使用 lsof，缺工具或無法核對時保留 UNKNOWN。
- 情境核對通過、清理未知時，情境與總結果保留 UNKNOWN；確認殘留仍為 FAIL。體檢卡顯示清理核對限制。
- 既有自測依平台核對結果，加入非 Windows 清理的合成測試，不跳過檢查。

## 1.16.0 (2026-10-24)

Replaceable observation sources, bounded agent scenarios, generic boundary cassettes, two-sided declaration checks and generic check cards. Fix prior full-trace findings; see water-sources.md and check-card.md.

## 1.15.3（2026-10-24）

- 站框依文字縮小，長名稱換行；單線保持置中。
- 再點選中路線或「展開全部」回到全部。
- 先淡出再收合，展開時反向播放；連點以最後選擇為準，減少動態時直接切換。

## 1.15.2（2026-10-24）

選中路線時，手機與桌機都依段落順序，將每站第一次出現的位置由上到下排成置中單欄。只畫這條路線的站，圖上方說明站數與回到「全部」的方法。相鄰站以垂直直線連接；重訪站只畫一次，回頭線從側邊繞回，步驟清單仍列出每一段。

切換路線時，同一站用 0.4 秒平滑移到新位置；開啟 prefers-reduced-motion 時不做過渡。「全部」的分層圖與區塊總覽排法保持不變。

## 1.15.1（2026-10-24）

- 路線圖改為依最淺路線深度由上往下排版；手機每排最多三站，超出拆為相鄰排。
- 跨層使用平滑三次曲線，同排直連，回頭線從側邊繞行。
- 箭頭固定大小；區塊總覽依路線段數分三級線寬，無跨區塊連線時照實說明。
- 縮小站框留白；單線模式保留直線排列。路線格式、核對、地圖、健檢、報告與流程圖不變。

## 1.15.0（2026-10-24）

- 新增按需路線動態圖：候選路線、代理白話命名、原文與地圖核對、自動排版、離線深淺色與逐步播放。
- 錯誤位置排除整條路線；未找到地圖邊以虛線標記人工判讀。
- 手機超過十八站改為單線或區塊總覽；既有地圖、健檢、報告與流程圖不變。

## 1.14.3（2026-10-24）

- 健檢模組圖在 640px 以下改為分區兩欄方塊，不畫連線；按檔案數顯示比例色條。
- 手機方塊與桌機圖均可展開用途、使用與被使用的區塊及條數、檔案分布與相關問題卡。
- 測試程式改放獨立灰色區；不改靜態分析、給 agent 的報告與流程圖。

## 1.14.2（2026-10-24）

- 健檢模組圖每個區塊只出現一次：含入口優先，其次為正式路線、只有測試在用，其餘為沒人用。
- 框內列出檔案總數與混合分布；框色依分區，圓點計入涉及來源或目標的問題卡，同卡在同框只計一次。
- 同區採相鄰方塊位置平均值排序；手機採單欄圖，不改流程圖。
- 既有自測加入方塊名稱唯一及圓點卡數檢查；靜態輸出與給代理的報告不變。
- 版本欄與末段目前版本同步為 1.14.2。

## 1.14.1（2026-10-24）

- 只更新給人閱讀的健檢與流程圖，共用白話轉譯表；技術原文、檔名及定位收進可展開細節。
- 健檢依來源、目標區塊及問題種類合併卡片，按嚴重程度排序；打包帶入單獨分類。群組保留完整檔案清單，模組圖依入口、正式路線、只有測試與未用檔案分區。
- 流程圖增加最多十二個主節點及細步驟分組，自行產生向下分層的曲線圖；窄螢幕使用縮排分支，保留原有來源檢查與失敗顯示。
- 靜態分析器、邊、缺口及給程式讀取的報告模型不變。閱讀版的卡片數與原始引用筆數分別保留；發行版本與執行路徑屬輸出中既有的執行資訊。
- 既有自測增加白話文字檢查、卡片合併、分組完整性、主圖格式及來源定位的正反例。

## 1.13.0 (2026-10-24)

- GAS detection: tracked appsscript.json activates project analysis. A neighboring .clasp.json or .clasp.json.example supplies a repo-contained rootDir. Its .gs/.js files share a global scope. Out-of-snapshot absolute deployment paths remain GAS_ROOT_DIR_UNSUPPORTED; the manifest directory is retained for bounded source analysis.
- gasScopes accepts [{"name":"server","files":["src/server/*.gs","src/server/*.mjs"]}] for explicitly concatenated source. Patterns are repo-relative (*, **, ?). Files are never executed or built. Without a manifest or configured scope no GAS analysis is activated.
- GAS_GLOBAL_REFERENCE joins unqualified references to another file's top-level function/const/let/var/class in the same scope. names and sites carry identifiers and source lines. Comments, strings, member properties, same-file names and simple local bindings are excluded. Multiple defining files produce GAS_GLOBAL_AMBIGUOUS without choosing a target.
- gasEntryPoints lists conventional GAS top-level entry names and literal ScriptApp.newTrigger targets, with file and line. roots:"auto-gas" uses unique entry files; explicit roots remain unchanged. Inventory-wide gasAnalysis and frameworkPathLoads list discoveries even outside the chosen root closures.
- GAS_CLIENT_CALL follows multiline google.script.run chains, skips handler configuration, and reports computed or unresolved names as gaps. SOURCE_EXPORT_NOT_DEPLOYMENT marks fallback source-export candidates; it does not prove the function exists in a deployed bundle. GAS_EXPORT_BRIDGE is a unique exported-function-name candidate for a top-level bundle forwarding wrapper.
- FRAMEWORK_PATH_LOAD supports GAS HtmlService file calls and include, Electron preload properties and loadFile. GAS HTML targets use deployment roots, then a same-directory source HTML, then a unique project HTML suffix. Missing or ambiguous paths remain gaps. Same-file const path.join/path.resolve(__dirname, literal) resolves. Helper-valued webPreferences is a separate gap; cross-file return dataflow is not inferred.
- New edges enter file closures, retaining candidate:true and runtimeVerified:false. This is static reference coverage, not execution coverage. New gaps and gaps reachable only through new edges have null historical IDs. Existing gap identities remain unchanged and legacyIds adds 1.12.1.
- Limits: bounded lexical parsing, not a complete JavaScript/TypeScript scope engine. Complex destructuring, type grammar, template interpolation, computed property/dataflow and entity-encoded HTML event attributes are not resolved completely. Normal HTML scripts, GAS scriptlets and literal event attributes are scanned. No general function call graph or runtime verification is added.
## 1.12.1（2026-10-24）

- JS 內容讀取：readFileSync、readFile、fs.promises.readFile、createReadStream 支援 fs 前綴與具名匯入；existsSync、statSync 不產生讀取邊。支援明示的 ESM 匯入別名，仍屬詞法候選。
- 字面相對路徑依序嘗試 repo 根與最近 package.json 目錄，以第一個存在的 inventory 目標為準；實際 cwd 未觀測。path.join／path.resolve 的 __dirname、new URL(lit, import.meta.url) 與 fileURLToPath 包裝按檔案目錄解析。邊附 resolvedFrom。
- 同檔字面陣列的 map、for…of 與唯一 const 陣列可展開；支援真實案例需要的一層同檔函式陣列參數，前提為所有可見呼叫都傳字面陣列。條件式只列可解析分支，不判斷真值。突變、重綁定、巢狀迭代、跨檔及一般運算不推導；依下列讀檔規則判斷缺口或計數。
- DATA_READ 的程式碼目標進入閉包並接續既有 import walker；dataReadFiles 與 closureCounts.dataRead 另計直接讀入的程式碼目標。JSON、圖片等資料只記邊。既有獨立 JSON URL pin 行為為相容保留，並非本輪內容讀取規則。
- 讀檔即交給 vm.runInContext／同類 vm API 或 new Function 的語法標 executes:true；它不證明程式執行。DATA_READ_TARGET_UNKNOWN 只報字面／可展開字面候選全部不存在，或計算式含可見程式碼副檔名（.js .mjs .cjs .ts .tsx .gs .html .css）、src/／lib/／scripts/ 目錄字面前綴（含 ./、../），或 executes:true。僅檢查路徑運算式內的字串片段，不從變數名稱推測。
- 其餘計算式讀檔每個呼叫計入根的 dataReadComputed；dataReadComputedSamples 附走訪順序前 20 筆定位。counts.dataReadComputed 是各根合計，共用呼叫於各根分別計數；頂層樣本附 root，最多 20 筆。未解析的條件分支同樣判定；已解析邊保留。計數不代表 gap、已解析依賴或執行證據。
- legacyIds 補 1.12.0；本輪新缺口與只因新邊走訪才出現的缺口不捏造歷史 id。舊邊與既有 gap 身分由逐 repo 對照驗證。
- TS 的 baseUrl／paths、相對 extends 與副檔名替代維持 1.12.0 能力；不支援 package extends、完整 bundler 語意或完整作用域／資料流分析。HTML／CSS 讀入後保留為閉包檔案，未新增 DOM、CSS 或 GAS 全域函式呼叫分析。

## 1.12.0（2026-10-24）

- G51：execute／executemany／executescript 的字面 SQL 以 INSERT／UPDATE／DELETE／REPLACE／UPSERT／CREATE／DROP／ALTER 開頭，即保留 DB_WRITE_CANDIDATE；未綁定連線為 UNKNOWN。SELECT／COUNT／SHOW 保持 DB_READ。支援多項 with 與 closing 內的連線；其他不明 receiver 不憑名稱升為 DB。
- H1：明示 .js／.jsx／.mjs／.cjs 不存在時依序尋找 .ts／.tsx／.mts／.cts；無副檔名依序尋找 .ts／.tsx／.js／.jsx／.mjs／.cjs／.json 及 index。保留未解析 DATA_READ、DYNAMIC_IMPORT 證據。import type、export type 的已解析邊標 typeOnly。
- G53：gap-reconcile 接受 legacyIds 的舊觀測 id，證據附 matchedVia 與 observedGapId；同值跨版本時標最新匹配版本。多對一歷史 id 若指向多個現行 gap，需已有精確來源位置才能消歧；不猜配。
- M12：補同檔單層 Python 包裝函式的路徑參數候選；保留原 gap、候選標籤與 runtimeVerified:false，巢狀函式不借用外層作用域。可保留 append／extend 前的已知路徑前綴；跨檔、第二層傳遞與未知變換不推導。
- G52：PEP 562 候選依來源／單一目標／種類去重，occurrences 記次數，sites 保留行號與模組名稱；閉包目標聯集不變。

函式層、完整證據分類、執行證據回寫、click 巢狀 group 與資料庫檔名解析仍維持目前手工或既有限制。版本報告的 PASS 僅涵蓋已執行的靜態驗收，不宣稱目標程式已執行。

## 1.11.0（2026-10-24）

- H1：新 TS 解析器未通過既有未解析補充邊回歸，依停損還原。此版不宣稱解決 TS／JSX 問題。
- H2／M6：補 JS 字面 URL／__dirname 路徑與同檔單層方法轉送、宣告式 command/args 及 NODE_OPTIONS 候選。保留 candidate／runtimeVerified:false。
- H3：DB 分類需有 sqlite3／aiosqlite／SQLAlchemy 連線來源或明示連線型別；SELECT／COUNT／SHOW 為 READ。未證實 receiver 降為 CONTAINER，不代表已證實是容器。DB 檔名／表名無法解析時為 UNKNOWN。
- H4：支援 repo 外獨立基準，校準集合與已揭露缺口分開。
- M5：TYPE_CHECKING 與 JS import type 標 typeOnly。files 保留全部候選；runtimeFiles／typeOnlyFiles 與 closureCounts 分開計數。runtimeFiles 仍是靜態候選，包含可選的 lazy 邊，並非觀測執行清單。
- M8：zeroCoverage 每列有 inferredReferences／runtimeObserved。外部 verified 宣告不能使 runtimeObserved 升為 true；本版未新增執行證據回寫快照。
- M10：同次分析快取函式結構與模組解析；完整讀回 hash 仍直接讀磁碟。
- M13：PEP 562 的模組層字面字典、直接索引或 tuple 解包加 import_module 可產生 lazy 候選；保留原計算式 gap。
- G34：同檔單層、多個 return 的字面 list／模組層字串常數逐一列候選；支援字面字串無參數 strip。條件、跨檔、第二層呼叫與一般計算不求值；python -c 仍是直譯器程式碼，不當成 project script。
- M12：新增 Python *args 包裝器解析未通過巢狀作用域回歸，依停損還原。本版不宣稱解決 httpie benchmark 的零覆蓋問題。

本輪為部分交付，H1、M12 FAIL。自測包含 143 項基準與 11 項新增檢查；H1、M12 新檢查只確認還原後的已知限制，不是能力驗收 PASS。
自動引用漏斗、函式查線、click 巢狀 group 擴充、執行證據寫回快照均未實作。完整實測與未驗證 repo 見交付報告。

## 1.10.0（2026-10-23；歷史記錄）

- G50：身分只取 code、相對 POSIX path、line 與去除附註的 data；修正設定提示覆寫身分的問題，影響筆數見本節實測值。
- G49：在附註合併前保留原欄位，分別保存 1.8.0 與 1.9.0 的 data 快照，舊 ID 對上率與逐筆例外見交付報告。
- G39：把 wrapper 首個設定相依呼叫的 CWD_ENV 缺口輸出為獨立 gap，保留原 target 未知證據及設定提示。
- G34：新增同檔一層、單一無條件 return、全字串 literal list 的保守代入；指定真實案例具有兩個 return 與變數元素，依規則維持原 gap，驗收為 FAIL。

G50 measured: 8 existing crewAI IDs corrected; 136/136 retained reference-repository occurrences, 204/204 full current occurrences unchanged. Source: E2-G50.json#/counts.

### 身分與歷史欄位

`scripts/gap-shape.mjs` 的 `GAP_ANNOTATION_FIELDS` 是附註排除清單：`resolution`、`configHint`、`configCandidates`、`inferredEdges`、`inference`、`reconciliation`、`runtimeVerified`、`declaredVerified`、`confidence`、`provenance`、`legacyIds`、`legacyId`、`legacyIdBasis`、`annotationFields`。頂層其他欄位一律不參與身分。

`GAP_CONFIG_ANNOTATION_FIELDS` 列出 `command`、`commands`、`reason`；只有合併提示時新增的欄位會記入 `data.annotationFields` 並排除，原本就是缺口資料的欄位繼續參與身分。其他事後推論／對帳資料應放在上述附註命名空間，不得混入新的身分欄位。

雜湊演算法與欄位順序維持凍結；本版修正的是附註進入身分的錯誤。1.8.0／1.9.0 的舊公式仍以當時資料快照計算。`legacyIds` 是歷史投影，不代表該缺口必定曾出現在舊版閉包；真實存在性與多對一關係必須以逐版實跑對帳為準。新增獨立 CWD_ENV 缺口的舊 ID 為 null，不捏造舊版輸出。

同檔 literal 回傳僅支援唯一、無裝飾器、無重新綁定的模組層函式與無參數呼叫；呼叫參數亦可來自既有規則證明的同函式單次指派。以上單回傳限制為 1.10.0 行為；1.11.0 的多回傳擴充見下節。跨檔、第二層回傳、方法、一般計算及突變仍維持缺口。G40 仍將 `uv run python -c` 分類為直譯器。

本版為部分交付。靜態提示不證明執行；外部推論不擴張閉包；coverage 最多 CO_OCCURRED；VERIFIED 需呼叫邊觀測；REFUTED 需 complete:true；declaredVerified:false 不會升級。

G49 的歷史快照另保留 1.6.0 的結構化 wrapper reason，以及 G40 之前的 TARGET_UNKNOWN code／project-command reason；不使用後版已正規化或重分類的值冒充舊輸出。

移除最後一個附註後的空 data 與未提供 data 視為相同空身分；command／commands／reason 的動態排除僅作用於被標記的頂層欄位，原資料中的巢狀同名欄位保留。

## 1.9.0（2026-10-23）

- G47：literal import() 目標進入閉包；沿既有 walker 邊繼續走訪，候選標籤不升級，計算式 import 保留缺口。
- G39：1.9.0 的 wrapper 修正只保證 occurrence 層；1.10.0 已補頂層獨立 CWD_ENV 缺口。現況以實跑對帳為準。
- G48：雜湊公式雖自 1.8.0 凍結，1.9.0 仍曾把附註帶入身分；1.10.0 修正。legacyIds 是歷史投影，不能代替舊版真實輸出對帳。
- G34：恢復 append/extend 的 uv 前綴提示與同檔單層 uv_path 追蹤；尾端參數及執行期未知仍明列。

本版為部分交付，不是完整驗收通過版。靜態提示不證明執行；外部推論不擴張閉包；coverage 最多 CO_OCCURRED；VERIFIED 需呼叫邊觀測；REFUTED 需 complete:true；declaredVerified:false 不會升級。

歷史自測數更正：1.8.0 為 135 項，1.9.0 為 139 項（135 + 4：G39、G48、G34、G47），1.10.0 為 143 項；不可寫成以 1.8.0 為基準的 137 + 2。

## 1.8.0（2026-10-23）

- G43：gapId 以 code、repo 相對 POSIX path、line 與排序後 data 計算；legacyId 保留舊公式供本版對照；拆分群組時對應原版合併代表，legacyIdBasis 明示可能的多對一對應。
- G44：wrapper 合併依名稱與定義位置區分，不同 wrapper 保留各自的 gapId。
- G38：專案設定提示附於原 gap，推論保留 gapIds 關聯並在每個閉包只掛載一次。
- G34：同函式支配呼叫點的單次指派支援 else／try，關鍵字限定參數可辨識；跨函式、突變與不完整分支保守保留缺口。
- G39：wrapper 的設定提示傳回原 gap、callSites 與 occurrences，保留既有 code、字串 detail 與 data.reason。
- G45：補列字面 import()、JSON DATA_READ 與統一 node: 內建依賴；補邊不改走訪，閉包外目標標 inClosure:false。

以上為實作範圍；完整驗收狀態與限制以本版交付報告為準。保留前版歷史限制記錄。靜態提示不證明執行，外部推論不擴張閉包，coverage 最多 CO_OCCURRED。

## 1.7.0 缺口與匯入邊

- G38：此為 1.7.0 歷史停損記錄；1.8.0 已修正設定 gap 與推論重複。本版狀態以 1.11.0 交付報告為準。
- G39：保留既有 code 與 cwd/env 缺口，detail 改為字串，原結構資料與字串 reason 保存於 data。
- G34：保留 run_crew 的變數名稱提示，新增 plot_flow 完整 if/else 分支代入；任一分支不可代入就維持原 gap。
- G40：uv run python 的程式碼與檔案模式標為直譯器，不查 project.scripts，保留環境未知。
- G41：推論 id 由來源位置、目標與種類計算，匯入及對帳依 id 去重，宣告 false 不會升級為 true。
- G42：可歸屬的拒收或壞行只停用所屬 run 的負向判定；無法歸屬時保守停用負向證明並明報。
- JS：在 preserved loop 只新增已解析 static-import 邊輸出，以來源、行號與目標去重，走訪內容不變。
- toolVersion：derive-map 從 SKILL.md 的版本欄位讀取工具版本，不在程式寫死。
- gap 欄位：共用正規化讓 gap 具有 line，整檔為 null，detail 為字串，結構資料保留在 data。

以上為 1.7.0 歷史限制，G38 已於 1.8.0 修正。外部推論仍不擴張靜態閉包，coverage 最多 CO_OCCURRED。

## 1.6.0 外部目標與觀測

- G35：支援四種外部推論目標與 pythonSourceRoots 模組換算，分種計數且不擴張靜態閉包。
- G34：同函式單次指派的 list / tuple、uv 字面值與 shutil.which("uv") 可用於 uv run / sync / lock 的設定缺口判斷。
- G36：觀測支援外部種類與 value，可用 gapId 或同函式 import 行對應，仍需精確目標才能驗證推論邊。
- G37：gap-reconcile 新增 --out，stdout JSON 的 outputs 列出結果與摘要絕對路徑。

格式、對應限制與保守預設見 [推論與執行對帳](inference-runtime.md) 的 1.6.0 節。

## 1.5.0 推論與逐 gap 對帳

外部推論用 derive-map --inferred-edges，不擴張靜態閉包；逐 gap 執行證據用 gap-reconcile.mjs。使用前讀 [推論層與執行對帳](inference-runtime.md)。coverage 最多 CO_OCCURRED，VERIFIED 只來自精確呼叫邊 observation；REFUTED 需要 complete:true 且保留原推論。

