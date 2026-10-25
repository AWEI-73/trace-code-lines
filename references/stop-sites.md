# 宣告對照：阻擋點

用途是把終止或拒絕候選與專案宣告並排，產出診斷紀錄交給 agent 判讀，不代替 Owner 決定。此檢查位於既有宣告對照底下，不是新的執行 Gate。預設不啟用；report 設定加入 stopSites 才會掃描地圖母體中的 JS／TS／Python。受查專案不會被載入或執行。

## 提供宣告與對照表

最簡單是在受查 repo 的政策文件寫一行：

~~~text
Hard-block only: authorization violations, credential use.
~~~

report-config.json 保留原 maps、outDir 等設定，加入：

~~~json
{
  "stopSites": {
    "policy": {"file": "POLICY.md"},
    "mappings": [
      {"category": "authorization violations", "reasonCodes": ["ACCESS_DENIED"]},
      {"category": "credential use", "keywords": ["live credential use"]}
    ],
    "repairable": {"reasonCodes": ["MISSING_INPUT"], "keywords": ["missing input"]},
    "reasonCodePattern": "^[A-Z][A-Z0-9_]{2,}$",
    "statusPattern": "^(error|failed|denied|rejected|blocked)$"
  }
}
~~~

執行原來的指令：

~~~text
node scripts/report.mjs --config report-config.json
~~~

policy.file 以受查 repo 為根，只讀一般檔案，不接受絕對路徑、越界或 symlink。可選 sha256 核對政策全文。Markdown 支援上述單行清單，以及「允許硬擋：」「硬擋僅限：」；頂層逗號、分號與頓號分隔類別，括號內保留。其他政策格式請由 agent 讀原文後提供 JSON，不宣稱可理解任意自然語言政策。

JSON 政策以 categories 列允許類別，以 mappings 列 reason code 或關鍵字。每類的 anchor 必須指向原文件的真實文字；機器核對該行含 expect，並保存原行與 hash：

~~~json
{
  "categories": [
    {
      "id": "authorization",
      "label": "authorization violations",
      "anchor": {"file": "POLICY.md", "line": 1, "expect": "Hard-block only: authorization violations"}
    }
  ],
  "mappings": [{"category": "authorization", "reasonCodes": ["ACCESS_DENIED"]}]
}
~~~

設定 policy.file 為此 JSON 檔即可；引用的原文也須位於受查 repo。對照表類別必須存在，不接受憑空建立的分類。選用對照表是使用者或 agent 的解讀，錨點與 hash 只核對來源完整性，不證明語意判斷。未提供或未抽出宣告時，只列候選，標示「沒有宣告可對照」，不判對錯。

體檢卡設定亦支援 stopSites，另提供 files（repo 相對檔案清單）與 routes（既有閉包的 root、files、role）。缺少路線時保留 UNKNOWN；不要捏造閉包。report 會自行從 maps 取得清單與正式／測試角色。

## 三類與逐站資料

- 底線：單一宣告類別吻合，附宣告原文錨點。這是可覆核的詞法／表格對照結果，不是准許硬擋的授權。
- 要處理：有正式檔案閉包或已綁定站點觀測，且是輸入、格式或可補資料問題而直接拒絕的候選。建議改成 finding、補資料，或降級交付並記錄限制。
- 不確定：私有／型別防呆、混合條件、多個類別吻合、例外可能被接住、缺語意或路線證據，逐筆列缺什麼。不可只依 reason code 硬判。

每站保留 path#symbol、行與欄、原碼片段及 SHA-256、來源全文 hash、訊息、reasonCode、觸發條件候選、分類依據及缺口。同一 reason code 可在不同位置分到不同類。

維修單以檔案、原因與分類合併，保留組內全部站點與錨點，不把不同分類混成一項。底線顯示「底線」；要處理最多成為 handling；此檢查不產生 broken，既有壞了的計數規則不變。health.json、health.html、report.md 與體檢卡加入對照區塊，既有欄位保留。

## 路線、水源與驗證

正式檔案閉包只表示靜態可達上界；不是函式呼叫圖，也不表示該分支實際執行。只有既有水源的 sourceBound 與 executedSites 確切行號才標 siteObserved；即使有行覆蓋，也不保證 throw／exit 分支真的命中。測試閉包不會冒充正式路線。歷史業務次數不能當本版本站點證據。

維修建議可沿用已綁定、涵蓋修改檔的測試命令；找不到時明寫缺命令。另可設定 verificationCommands，以 file 與 command 陣列提供待執行的專案驗證指令；設定指令不表示已執行。驗證需各跑一個可修復輸入與合法底線反例，保留受影響入口結果。重跑 report 只能核對分類與錨點，不能證明程式已修好。來源漂移與政策 hash 不符須重新綁定，不沿用舊結果。

## 限制

詞法分析不是完整 AST 或跨檔資料流。掃描 throw、raise、process.exit、sys.exit，以及直接回傳的錯誤狀態／reason code；目前不追蹤匯入 helper、別名或計算式拒絕。只展開單跳同檔、無分支的 throw／raise wrapper，且保留 wrapper 本身的不確定性。匿名函式、複雜 TS 型別、動態訊息、例外傳播、內部防呆可能誤報或漏報；回傳錯誤物件也可能只是資料，仍須讀呼叫端。沒有 reason code 的準確度較低。

自測使用合成資料；真實案例校準與人工參考答案不隨公開包交付。校準應同時列匹配覆蓋率、全母體一致率、匹配站點一致率、逐類差異與未偵測站點。沒有門檻時如實報告，不依答案硬編專案規則。
