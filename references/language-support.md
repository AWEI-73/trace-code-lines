# CJS、Python 與終點掃描

## CJS

- 使用 Node 內建模組及自有詞法掃描，不 import 或執行目標。
- require("./x")、module.require("./x") 依序找精確檔、.js／.cjs／.mjs／.json、目錄 package.json 的 main、index 同組副檔名。main 可指檔或目錄；循環與越界不跟隨。
- require.resolve 產生 resolutionOnly 邊，保守納入候選閉包；不能據此推論模組已執行。
- 非相對套件名列 externalDependencies，builtin 有獨立旗標；不把缺 node_modules 當缺檔。
- require(運算式) 記 DYNAMIC_COMPUTED 與 gap。module.createRequire／createRequire 記載入基底與 CREATE_REQUIRE_BASE_UNRESOLVED；不猜後續 alias。
- 明確 const／let／var 宣告為函式的局部 require，在所屬大括號範圍內排除；這不是完整作用域／型別分析。
- 支援 TS／TSX／JSX、.js 類副檔名替代、無副檔名與 index；tsconfig／jsconfig 的 baseUrl、paths 與 repo 內相對 extends 已支援。不處理 package exports/imports、任意 alias、bundler 設定、套件 extends、安裝樹解析或原生 addon。

## Python

- import a.b、from .x import y、from ..pkg import z、逗號多項、括號跨行與反斜線續行皆支援；yield from／raise from 不當成 import；載入可解析的父套件 __init__.py。
- pythonSourceRoots 依給定順序尋找 repo 內模組；同名多根列歧義 gap，取首個。未給定預設 repo 與 src。
- from 套件 import 名稱：先載入套件，再嘗試同名子模組；找不到子模組可能是屬性，不據此製造缺檔。
- 標準庫與第三方皆列 STDLIB_OR_THIRD_PARTY，不讀取或執行外部安裝樹；不宣稱已分辨外部套件是否實際存在。
- importlib.import_module 與 __import__ 的字面值為 DYNAMIC_LITERAL；計算式為 DYNAMIC_COMPUTED。相對動態 import 缺 package 上下文時留 gap。
- subprocess.run／call／Popen／check_call／check_output、os.system 中的 python x.py／python -m pkg.mod 記 SUBPROCESS_ARG。支援字面命令、字面 argv 與 sys.executable。
- 子程序候選依 repo／來源根與 caller 目錄保守查找；cwd、env、shell 展開未評估，逐呼叫列 SUBPROCESS_CWD_ENV_UNKNOWN。第一個 executable 是非 Python 字面值時列 EXTERNAL_COMMAND 與程式名，不計 gap；計算命令仍記 SUBPROCESS_TARGET_UNKNOWN。
- sys.path.append／insert／extend 的 __file__ 字面路徑可解成額外候選來源根，附賦值與呼叫行證據；其餘保留 gap。
- 白名單支援 Path、str、resolve、absolute、parent(s)、dirname、abspath、normpath、join、字面斜線組路徑及先前可解賦值。越過 repo 根仍拒絕。
- 候選根只作用於本檔解析，不推論分支真值、跨檔路徑副作用或執行期優先序；不作完整資料流與作用域分析。不支援 namespace package、import hook、一般 alias 追蹤、條件真值分析、運算式求值、字串 escape 解碼或完整 AST。局部遮蔽亦可能誤判。
- 註解、一般字串及 docstring 不當程式掃描。複雜 f-string、JS regex literal、非常規語法仍可能漏邊或誤判；不能稱 runtime closure。

## 終點候選

- Python：open 的 w／a／x／+ 模式、Path.write_text／write_bytes、json.dump、shutil.copy*／move、os.replace／rename。DB commit／add 等須有連線來源或明示連線型別；execute 類呼叫的已知字面 SQL 讀寫可獨立分類，未綁定 connection 為 UNKNOWN。
- JS：writeFile／appendFile／createWriteStream／rename／copyFile（含 Sync）。
- 每列有 writer、line、roots、原始目標運算式、呼叫片段與 STATIC_CANDIDATE。SQL 以 SELECT／COUNT／SHOW 開頭列 DB_READ；寫入列 DB_WRITE_CANDIDATE；未知 SQL 列 DB_OPERATION_UNKNOWN。非已知字面 SQL 且未證實 DB receiver 時保留 CONTAINER；名稱提示不能證明連線。resolvedEndpoint 記 databaseFile／tables，無法解析填 UNKNOWN。
- 讀取與寫入未做全域資料流；這個表不能證明成功寫入、共享終點或漏水點。候選列數也不等於不同實體終點數。
- derive-map 的 endpointTable 可交 coverage-reconcile；沒有本輪實檔／收據，狀態保持 UNKNOWN。

## 標準庫 Python 覆蓋

此輪採 sys.settrace，輸出 JSON 格式如下；不支援直接讀 pickle／trace 的 .cover 顯示文字。

~~~json
{"schema":"python-settrace-v1","files":[{"path":"/absolute/isolated/example.py","lines":[{"line":1,"count":1},{"line":5,"count":3}]}]}
~~~

collector 用 sys.settrace(callback)，只在 event == "line" 時累加 (frame.f_code.co_filename, frame.f_lineno)，最後 finally: sys.settrace(None)。
資料由 Python 標準庫 json 寫 stdout，Node execFileSync 以 encoding:"utf8" 捕捉後 fs.writeFileSync 保存為 LF。
原檔讀取由 Node 完成；合成測試以 stdin 傳 JSON source，Python compile／exec 僅執行自建字串。
Python 子程序以 -I -B -X utf8 執行標準庫合成來源。
可重跑的完整 collector 在 scripts/language-self-test.mjs；self-test 自行建立隔離 fixture，TRACE_PYTHON 可指定既有 Python。

每行 count 必須為非負整數、line 為正整數、path 為絕對路徑。任一行正數才算該檔 executed。
lineCounts 保存各行合計，無事件或未列檔案不能推定永遠未使用。
不涵蓋新 thread、child process、native extension，除非各自提供同格式原檔；未採樣部分 UNKNOWN。
trace 行事件發生在執行該行之前，不能當成功寫入證據；終點仍需獨立的本輪收據或前後清冊。
新採樣仍受需求單授權及零外部效果界線約束；有原始記錄就只重算，不自動執行專案。

## 1.3.0（歷史行為；現行見下節）

- G27：同檔 Python／JS 子程序包裝只追一層；可求值路徑成邊，尾段比對留 candidate:true／TAIL_PATH_MATCH，不跨檔、不追第二層。
- G24：確定區域容器改列 LOCAL_CONTAINER_MUTATION 與 receiverHint:LOCAL_CONTAINER，繼續保存可查；參數、屬性、模組變數、重新指派與無法判定者保留 DB_MUTATION_CANDIDATE。
- G25：Registry 型別註解／泛型不當成取用；屬性鏈的 register／action／tool／command／route 裝飾器保留 REGISTRY_DISPATCH gap。

LOCAL_CONTAINER 只在同一個可識別函式內的同一區塊有先前字面容器綁定、且無其他值重新綁定時成立；不是完整 AST 或別名分析。
此列仍在 endpointTable.endpoints，operation=LOCAL_CONTAINER_MUTATION，receiverHint=LOCAL_CONTAINER，status=STATIC_CANDIDATE；不計為資料庫寫入候選。
endpointTable.receiverHintCounts 分 DB_LIKE_NAME、UNKNOWN_RECEIVER、LOCAL_CONTAINER 三類；排除假陽性不刪原始呼叫證據。
未識別的函式語法、複雜解構或作用域不推定為區域容器。

## 1.4.0（歷史行為；DB 分類現行見上節）

- G28：容器判定採同一函式範圍；append／extend 只有 DB_LIKE_NAME 才列 DB_MUTATION_CANDIDATE，其他保留為 CONTAINER_MUTATION_CANDIDATE。
- G05：保留既有 Python session.add、cursor.execute、uow.add 與未知別名的 DB 寫入候選，避免名稱白名單漏報。
- G24：支援巢狀 for／if／with／try、型別註解、comprehension 與 JS 陣列／Map／Set；非容器重新賦值仍不標 LOCAL_CONTAINER。
- G29：同檔同包裝函式合併一筆 gap，callSites 保存呼叫位置，codes 與 occurrences 保存所有原始缺口內容。
- G27：同檔包裝最多追兩層，不跨檔；第三層與未解作用域仍留 gap。
- G10：Python 兩層包裝可保留 Path 字面尾段候選及執行環境缺口。
- G12：JS join 與直接字面參數的尾段比對保留全部候選、candidate:true 及 runtimeVerified:false。
- G30：同檔可確認的 click group／command 改列資訊性 CLI_COMMAND_REGISTRATION；未解綁定仍列 REGISTRY_DISPATCH。
- G22：固定套件目錄的 f-string 列舉直接模組及子套件候選，同時保留 DYNAMIC_COMPUTED gap。
- G31：Join-Path 支援任意順序的 -Path／-ChildPath、多段位置參數與 -AdditionalChildPath 字面清單；其他變數仍留 gap。

CONTAINER_MUTATION_CANDIDATE 是非 DB 分類，receiverHint 仍為 UNKNOWN_RECEIVER；不宣稱接收者已證實是容器。所有候選的 status 仍為 STATIC_CANDIDATE，完整性／信心狀態詞彙不變。1.3.0 新增的 Python append／extend、JS add／update 只有 DB_LIKE_NAME 才進 DB 分類；原有 Python add／update 等未知別名仍保留 DB 候選。insert 不是 1.3.0 新增的 DB 動詞，本版只在已證實區域容器時列為 LOCAL_CONTAINER_MUTATION。

包裝 gap 以檔案與包裝函式名稱合併，頂層 code／line／detail 保留第一筆，codes／occurrences 保存全部缺口；消費者查任一呼叫位置應讀 callSites，查任一缺口種類應讀 codes。一般非包裝子程序缺口也附 callSites。合併筆數不等於呼叫次數。兩層追蹤仍是詞法候選，不代表執行；沒有可解析目標也保留 gap。

固定 f-string 目前支援完整模組最後一段為單一插值、前面為固定套件目錄的形式，例如 f"pkg.sub.{name}"；不求值插值，不遞迴列舉整個目錄樹，缺目錄或複雜形式只留 gap。click 別名、未知裝飾器與跨檔 group 不解析。Join-Path 的巢狀呼叫深度仍限兩層，單次可有多段字面路徑，絕對路徑／其他變數不解析。

## 1.11.0 補充

TYPE_CHECKING 與 JS import type 邊標 typeOnly，原 files 不刪除；runtimeFiles／typeOnlyFiles 分開，仍屬靜態候選。PEP 562 字面 lazy map 會補候選但保留計算 gap。
JS URL／__dirname 路徑可經同檔一層方法轉送；宣告式 command/args 只證明配置引用。NODE_OPTIONS 支援字面旗標與字面 URL 串接；一般 env 資料流仍手工。
1.11.0 的 H1 與 M12 曾依停損還原；1.12.0 已重新實作並以 ky、taxonomy 與 httpie 真實來源驗收，範圍與限制見 changelog.md 的 1.12.0 節；現行細節以本文件與 runner.md 為準。

JS 內容讀取與 dataRead 閉包計數見 changelog.md 的 1.12.1 節及 runner.md；檔案層候選不是執行證據。

1.12.1 G121B：JS 內容讀取的 DATA_READ_TARGET_UNKNOWN 僅用於不存在的字面／可展開目標，或含程式碼副檔名、src/／lib/／scripts/ 字面前綴、立即求值 executes:true 的計算式。其他計算式讀檔只計 dataReadComputed，提供每根與總數及前 20 筆定位；詳見 runner.md 與 changelog.md 的 1.12.1 節。
