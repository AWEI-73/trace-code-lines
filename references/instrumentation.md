# 裝儀器：執行證據

依序使用 plan、run、collect、coverage-reconcile、remove。所有工具僅用內建模組／標準庫。
一般 plan 不寫檔；run 未給 --enable 時只輸出計畫，即使提供命令也不執行。
新採樣仍需要本次工作的執行授權。沒有授權時記 UNKNOWN，繼續可做的來源分析。

## config 與命令

JSON 欄位：mode（active／passive，預設 active）、cwd（已存在的絕對路徑）、
outputDirectory（TEMP 底下尚不存在的子目錄）、writeRoots（絕對路徑陣列）、
executables（執行檔路徑或 PATH 名稱，plan 時解析）、pythonExecutables（其子集）、
isolated:true、network（deny 或 loopback，預設 deny）、wrapPythonChildren:true。
environment 可指定子程序環境；denyCommandPatterns 是額外禁止的 argv 正規式，例如禁止套件安裝。
執行前把 TEMP/TMP 設為授權根；輸出不可沿符號連結；不要以廣大根規避範圍限制。

~~~text
node scripts/instrument.mjs plan --config config.json
node scripts/instrument.mjs run --config config.json --enable -- node entry.mjs
node scripts/instrument.mjs collect --manifest <output>/instrument-manifest.json
node scripts/coverage-reconcile.mjs --config reconcile.json
node scripts/instrument.mjs remove --manifest <output>/instrument-manifest.json
~~~

根命令限目前 Node 執行檔。Node 子程序即使自備 env，仍補入 recorder 的 --import、V8 輸出與 config。
Python 以已宣告執行檔辨識，在 -I／-B／-X utf8 等直譯器旗標後插入 wrapper；支援腳本、-m、-c、stdin。
--version／--help 不需執行腳本，保留原命令；不把這種 probe 宣稱為 Python 程式覆蓋。
Node exec／execSync 的 shell 字串在 active 拒絕，不能把任意 shell 當 allowlist 執行檔。
被動模式不拒絕；原啟動器／設定不改。兩種模式都不授權新網路、模型或安裝行為。

## 事件與證據

每個 pid 一個 JSONL，含時間、pid、cwd、API、paths／argv／host、ALLOW／DENY、stack、phase。
attempt 是政策判斷。Python audit 僅提供動作前事件，不宣稱呼叫成功；collect.writes 必須同時具寫入意圖及前後快照變動。
open 成功只表示開啟／建立／截斷，不代表後續 buffered write 完整落盤。
Node 非同步子程序只攔 ChildProcess.prototype.spawn；同步子程序與 fs 函式用 Proxy apply，保留原函式的屬性與 symbol。
不替換回傳的 ChildProcess、stream 或 FileHandle，不改它們的方法；具名匯入由 syncBuiltinESMExports 同步。
Python 使用 sys.addaudithook 觀察 open、os.rename／remove／rmdir／mkdir、shutil、subprocess.Popen、os.system／exec／spawn／startfile、socket.connect／bind／getaddrinfo。
不替換 builtins、Popen 或檔案物件；拒絕時 audit hook 丟 PermissionError。
Node 啟動 Python 時仍可在命令邊界加入 wrapper。Python audit 不能改寫 argv；Python 子程序須明示 wrapper，Node 子程序須繼承 recorder 環境；否則在 active 模式拒絕。
Python 呼叫替身可明示 Node 邊界轉接入口；不宣稱 Python audit 可自動把任意外部執行檔換成替身。
sys.settrace＋threading.settrace 計算允許根及 cwd 的 Python 行數，排除儀器本身；原始格式 python-settrace-v1。
Python 行事件發生在該行執行前，不單憑計數宣稱寫入成功。

reconcile config 增加 instrumentCollect 指向 collect JSON；舊證據格式仍可用。
endpointTable 的每項可提供 writers:[{file,line,endLine?,column?}]，
另以 observedPaths（完整路徑）或 targetPattern（含根綁定的正規式）約束目標。
WRITTEN_OBSERVED 要求本輪某程序的寫入模式 open（含高階寫檔 API 的隱含 open）、rename／mkdir 等事件，以及前後快照的檔案 SHA 或目錄清單確實改變；另須 stack 對到 writer、目標相符、最窄 V8 range／Python 行數為正。
不逐次包 fd write。僅開啟 r+、重寫相同位元組或前後均不存在的暫存不算變動；stdout／stderr 與繼承 fd 保持原生語意，無獨立 fd-write 事件。
collect.writeEvents 保存未達雙重證據門檻的動作；writes 附 snapshotEvidence。快照讀取失敗留下 gap，外部並行變更與競態不能由 API hook 排除。
collect.logs 記錄 stdout／stderr 的 SHA-256、位元組數與最後 4096 字元；與 manifest 不符留 LOG_HASH_MISMATCH gap，讀不到留 LOG_UNKNOWN gap。
RANGE_ONLY 只有 writer 執行；UNKNOWN 連 writer 證據都沒有。
未配對寫入另放 instrumentLogOnly（LOG_ONLY），不灌進原靜態終點分母。
可設 excludeRoots 排除儀器，mappedOnly 排除未納入母體的標準庫等；排除清單仍保留。
提供 instrumentCollect 且它與 manifest 的 hash 相符時，自動排除該次輸出根；核對失敗留 INSTRUMENT_MANIFEST_UNKNOWN gap。
未設 mappedOnly 時，執行到卻對不到任何根的檔留 UNMAPPED gap，結果 PARTIAL。
寫入事件不等於業務新增：seed 還原、準備、暫存 rename 都要按情境解讀。

## 被動包裝器

~~~text
node scripts/instrument.mjs plan --config config.json --mode passive --launcher original.mjs
node <output>/launch.cjs
node scripts/instrument.mjs finalize --manifest <output>/instrument-manifest.json
node scripts/instrument.mjs collect --manifest <output>/instrument-manifest.json
node scripts/instrument.mjs remove --manifest <output>/instrument-manifest.json
~~~

這個帶 --launcher 的 plan 是明示建立包裝檔的例外。支援 Node JS launcher，產物內容只含 ASCII。
取得使用者同意才改用包裝命令；本工具不改原檔或任何設定。
結束該次工作、確認子程序都結束後 finalize 納入新記錄檔；不重設已列冊檔案 hash。
每套包裝器用於一次取樣；需要再採樣就新建輸出根，避免混合不同輪次。
被動記錄失敗不以 DENY 攔阻目標；記錄缺口／原程式錯誤仍須明報。

## 拆除與限制

manifest 保存 config SHA、完整命令／cwd、環境變更、記錄器 SHA、起訖時間、exit code、檔案及目錄。
檔案按位元組 SHA-256；manifest 自身以 JSON 副本中自身 sha256 清空後的 SHA-256 避免自我雜湊循環。
remove 先驗證 manifest 自身，再逐檔比 hash；只刪複製進輸出根的記錄器、runtime-config.json，以及被動模式的 launch.cjs。
被修改與未列冊檔案都保留，回報 PARTIAL 與完整殘留，不以 recursive delete 清掃。
原啟動器與受測程式建立的業務檔案不屬儀器所有，不在拆除範圍。
stdout.log、stderr.log、coverage、events、manifest 與 collect 輸出留在輸出根當證據，收據的 retained 逐檔列出；
下一次 run 要換新的輸出目錄。證據需交付時複製到授權的證據目錄；remove 收據寫 stdout，由呼叫端保存。

這是可觀察 API 的 hook，不是安全沙箱：原生 addon、直接 syscall、worker_threads、脫離程序、
外部 allowlist 執行檔內部、持有舊函式引用、刻意移除儀器及檔案競態可能繞過。
網路攔 net／tls 與 Python socket connect／bind／getaddrinfo，不宣稱 UDP／原生程式／全機網路監控。
不得用儀器取代授權與隔離；效果不明時記 UNKNOWN，不為補齊覆蓋自動放寬政策。

成功操作另存值級收據與具體陣列 selector，配置及限制見 run-once.md。collect.valueReceipts 保留所有觀測收據；可完整讀回的逐次變動也加入 writes。
reconcile 的 endpoint 可用 receiptIds 限縮到同一值的業務收據；不能只以同路徑的另一事件證明該值。

## 巢狀記錄器限制

被測程式若自行啟動另一套本工具記錄器，外層可能覆寫子程序的 NODE_V8_COVERAGE，使內層找不到自己的覆蓋檔。這種巢狀錄帶目前不保證可用；保留失敗與原始輸出，分開執行一般自測和外層觀測，不刪斷言或把未完成的錄帶標成通過。
