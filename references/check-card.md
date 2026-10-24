# 體檢卡設定

`check-card.mjs --config card-config.json` 接受 root、outDir、title、entries、inputs、outputs、sideEffects、cost、tools、runnability、declarations、water、evidence、limits。healthFile 可指到原健檢 HTML，工具只在 body 結尾插入新章節，不改原章節。tools 應附版本、執行檔或鎖定檔 SHA-256；未知值明示 UNKNOWN。

卡片沒有特定平台欄位。若需要接入平台，可另跑 `export-profile.mjs check-card.json proposal.json`，只輸出待審提案，預設不執行、不安裝。

declarations 每項有 id、description、kind、declared 與 implemented。每邊需 anchor（file、line、expect，可加 sha256）與 value；引用範圍以 root 為界。順序比較 kind=sequence，value 為依序動作陣列。agent 必須從兩邊實際引用的內容抽取值，工具核對錨點與值比較，不宣稱自動理解語意。

缺少實作或宣告時，該邊用 absent=true、anchor 指向搜尋範圍內的原檔，加 search.files（有 hash 的錨點清單）與 search.pattern。機器逐檔搜尋；有命中或缺任何一邊錨點就 UNKNOWN，不以猜測填空。「說了沒做」只針對列出的搜尋範圍，不是全世界不存在。

類別：SAID_NOT_DONE、DONE_NOT_SAID、FLOW_MISMATCH；完整相符為 MATCH，非順序值不同為 VALUE_MISMATCH，證據不足為 UNKNOWN。外部已安裝宣告的逐欄比較也沿用相同格式，並保留一致、不一致、未宣告及未知。外部原檔先唯讀複製到證據資料夾、附原位置與 hash，再引用該副本。

runnability 不由 exit 0 推斷；納入 water-source 的機器判決與原始回傳狀態。removalTrials 每筆列 processStatus、candidateStatus 與所有 candidates，不能只展示外層 PASS。

證據等級旁必須列 API 掛勾與 Python 子程序限制。公開包不含受查案例、私人來源或已安裝宣告。手機截圖用 capture-card.mjs，390 寬 iframe，等待字體、圖片與動畫完成，失敗留原因。
