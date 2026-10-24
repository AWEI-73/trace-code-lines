# 路線與執行覆蓋工具

三支 CLI 都是 node scripts/<name>.mjs --config <config.json>，只讀輸入、JSON 寫 stdout。
用 [runner.md](runner.md) 的 Node UTF-8 方式捕捉輸出；不提供任意目標寫入參數。
exit 0 表示量測完整，exit 2 表示缺口或 join 異常，exit 1 為配置／執行錯誤。
每次保留 argv、exit、stdout、stderr；異常不是自動的產品缺陷判決。

## route-skeletons.mjs

沿用 record-census.mjs 全部配置，增加 skeletonFields（selector 陣列，預設 typeKey）
及可選 sequenceKey（數字序號）。未提供序號時以檔名排序與 JSONL 行號排序；
有提供但資料缺序號時留 gap，不猜測時序。相鄰相同 tuple 折疊，tuple 用 JSON 編碼，
避免冒號欄位碰撞。相同骨架按 population 分開，每路線 runs 是 record 數，不是事件數。
每個 job 保留檔案／行號與 binding，versions 的來源依 binding.versionSource 區分 RECORDED 與 CURRENT_BINDING_MUTABLE。

## trace-one-job.mjs

配置例（替換根與真實欄位；不能執行示例來冒充實際證據）：

~~~json
{
  "root": "/read-only/records",
  "population": "production",
  "job": {"relativePath": "production/runs/job-1"},
  "stores": [
    {"id":"job","path":"job.json","mode":"one-json-per-file"},
    {"id":"events","path":"events","filePattern":"[.]jsonl$","mode":"jsonl"},
    {"id":"artifact","path":"result.json","mode":"one-json-per-file"}
  ],
  "joins": [
    {"id":"job-events","from":{"store":"job","key":"id"},"to":{"store":"events","key":"jobId"},"cardinality":"one-to-many","kind":"recorded"},
    {"id":"job-result","from":{"store":"job","key":"id"},"to":{"store":"artifact","key":"jobId"}}
  ]
}
~~~

- job.relativePath 從 root 解析，store.path 從 job 解析；外部 store 可明給絕對 root，path 相對該 root。
  不越過指定根、不跟 symlink；跨 store 的讀權仍以需求單為準，不以 config 自動擴權。
- store 可指單檔或目錄；目錄預設不遞迴，可設 recursive:true；filePattern 篩檔名。
  mode 必填，JSONL 壞行留下 file/line gap，其他有效行仍保留。
- 可給 where:{selector:scalar} 篩選某事件型別；selector 為點分字串或 key 陣列。
- join 預設每筆 source 恰好匹配一筆 target；one-to-many 要求至少一筆。
  缺 key、source 空、無匹配、多匹配或來源／目標解析缺口都 FAIL，保留 checks 與 anomalies。
  僅支持 scalar 嚴格相等；不以全文 includes 或 basename 冒充欄位 join。
- kind 預設 recorded；依目錄／檔名關聯放在獨立的 pathConventions 陣列，kind 必須為 PATH_CONVENTION。
  路徑慣例不是儲存內容中的明示外鍵。工具不猜欄位或自動遍歷其他磁碟。
- evaluation 固定 DEFERRED_UNTIL_ALL_LAYERS_READ；本題所需層結束後評估異常，不要求新採樣。

## coverage-reconcile.mjs

~~~json
{
  "coverageDirectory":"/evidence/v8",
  "staticMap":"/evidence/static.json",
  "endpointTable":"/evidence/endpoints.json",
  "staticScope":"source",
  "roots":[
    {"root":"/isolated/repo","scope":"source","sourceRoot":"/read-only/repo"},
    {"root":"/isolated/vendor","scope":"external","prefix":"vendor"}
  ]
}
~~~

staticMap 接 derive-map 輸出的 closures[].files，也相容 staticLayer.closures[].files。
每個 file 是相對路徑字串或 {path}。必須非空，並在報告保留靜態基準版本及校準狀態。
roots 依最長前綴匹配，scope + prefix + 相對路徑合併副本；sourceRoot 若給定，
逐副本讀 hash 核對，失配／讀不到留 gap，結果不得當無缺口驗收。
未映射的檔案列 UNMAPPED，須先補根綁定才能把它歸入特定母體。
Node 內部、匿名、eval 假檔排除，保存排除清單與原檔 hash。

判準是任一 function 的任一 range count > 0；頂層正數也算，具名函式計數另列。
全零檔列 loadedOnly；只匿名正數列 anonymousOnly，不宣稱業務分支被測到。
(a)(b)(c) 只對 staticScope，外部 scope 另列，故總執行數不必等於 a+b。
cOutsideV8 仍保留舊欄位，Python 另列 cPython；兩者都不是永遠未執行的證明。
Python 原檔使用 python-settrace-v1，行計數合併於 files[].lineCounts；正行計數才算 executed。
不把行計數假造為 V8 function range；anonymousOnly 只適用 JavaScript。
格式與標準庫採樣方法見 [language-support.md](language-support.md)。
指定 coverage 目錄必須屬於同一已綁定實驗，不混輪次。

### 終點表與證據邊界

~~~json
{
  "freshRootBasis":"來源清冊的隔離根建立與本輪歸屬證據定位",
  "completeInventory":true,
  "endpoints":[
    {"id":"output","identity":"exact bound root plus path template","files":[{"path":"/isolated/run/result.json","sha256":"observed-hash","origin":"CURRENT_RUN"}]},
    {"id":"temp","files":[],"finalEndpoint":"output","writerRanges":[{"coverage":"/evidence/v8/raw.json","url":"<WRITER_FILE_URL>","startOffset":10,"endOffset":30}]}
  ]
}
~~~

終點表由實際 writer 與完整根綁定建出；files 只能收這個終點的精確匹配，不按 basename。
可由前後清冊／成功收據產生，或給有獨立 freshRootBasis 的本輪隔離根清冊。
既有實檔但無寫入佐證是 UNKNOWN；每個終點也可給 writeReceipt 定位。
files 是已保存的證據，不由工具猜出，更不從 coverage 的模組執行推斷寫成功。
origin 應分 seed restored／準備輸出／業務新寫入；fresh-root 寫入統計包含準備及 seed。
completeInventory 為 true 而無匹配，僅稱 NOT_OBSERVED_ON_THIS_RUN，不稱永遠不會寫。
已 rename 的暫存檔需 finalEndpoint 已寫入，加上精確 writerRanges 在原始 coverage 正計數。
range 必須由實際載入的 source 定位並處理 loader 轉換；不可以隨便的模組 range 代入。
腳本核對原始 offset/count，不代替呼叫者的 source-to-range 綁定證據。
專案 adapter 留在案例，通用腳本沒有產品名稱或固定資料根。

## pathConventions 與輸出契約

pathConventions:[{id,kind:"PATH_CONVENTION",from:"job",to:"events",template:"job-directory/events",writer:{file,line}}]。
writerRoots 明列可讀 writer 根；工具讀回 writer 文字與 hash，另列 sourceFiles、targetFiles，狀態為 LOCATED／UNKNOWN，countedAsJoin:false。
這只保留可查證的路徑慣例，不做 recorded PASS／FAIL join，也不由 writer 靜態存在推論已執行。

記錄、骨架、分類、覆蓋、逐 job、版本鏈輸出均有 contract：layer、measuredAt、sources(path＋sha256)、populations(semantics)、metrics(欄位 selector＋母體＋單位)。
selector 的 * 與 [*] 表示同層鍵／陣列項，| 表示並列欄位；populationFrom 指該列的 population。
目錄語義為 NAME_ONLY_UNVERIFIED；經完整分類輸出綁定後才可為 CLASSIFIED。來源時間指本次讀取，不替代來源內的事件時間。

## version-chain.mjs

config.allowedRoots 為可讀根清單；hops:[{id,file,key}] 順序讀取。file 可用美元花括號包住先前 id 的欄位，只替換已讀 scalar，不執行表達式。
key 未給時保留整份 JSON；select:{array,where} 可選唯一陣列項，零筆或多筆都 UNKNOWN。
format:text 配 regex/group 可讀文字 metadata；format:sha256 只讀檔案雜湊，不執行 binary。
expectedSha256 可引用前跳，失配記 gap；branches:[{items,idKey,hops,checks}] 展開前跳陣列，子跳以 item 引用該列。
checks:[{left,right}] 比對已讀值。每跳保存檔案、sha256、key、value；缺檔／缺 key／前跳未知均 UNKNOWN，不能推論。
路徑正規化後必須位於 allowedRoots，所有祖先不得為 symlink。越界記 PATH_REFUSED，來源不讀取。

## 多 store 純 JSON 設定

複製 assets/trace-one-job.multi-store.json，填入已揭露的記錄根、job 相對路徑與各 store。
先執行 node scripts/trace-one-job.mjs validate --config config.json；此命令只讀設定，不查目標檔案、不啟動工作。
驗證 PASS 只證明設定結構；再執行 node scripts/trace-one-job.mjs --config config.json，才讀資料並檢查 join。
外部 store.root 必須明列絕對路徑；省略 root 時 path 相對 job，省略 path 時為該根。
key 可用點分路徑或陣列；一對多須明列 cardinality。重複 store、未知 join、錯誤 regex、越界相對路徑會拒絕。
pathConventions 與 recorded joins 分開；writer.file 填可由 writerRoots 允許的絕對檔案路徑，line 必須是支持該慣例的實際行。
範本中的 /absolute 根是待替換的範例；validate 不證明根存在。缺檔、缺欄位、多義與無匹配保持 FAIL／UNKNOWN。

## 1.3.0

被儀器化指令非零結束時留 RUN_FAILED，含 exit code 與指令，整體至多 PARTIAL。
從已通過完整性綁定的 instrument manifest 讀取指令與結束碼；保留原始 coverage 與終點證據，不因失敗而刪除已觀測的事實。

## 1.4.0

- G15：缺少模板值的 gap 附零起算 rowIndex／branchIndex；chain id 以內容 SHA-256 產生，原指定 id 保留在 declaredId。
- G17：JSON join 的 source.line 與匹配定位使用實際 key 行號；缺鍵、重複鍵或無法定位時保留 null 與 lineReason。

chain id 對 branch 定義與 item 的排序鍵內容計算 hash；相同內容會得到相同 id，重複列以 branchIndex／rowIndex 區分。頂層 hop 沒有所屬列時索引為 null。JSONL 仍使用實體行號；一般 JSON 以 key 路徑定位，重複祖先鍵也視為位置不唯一。
