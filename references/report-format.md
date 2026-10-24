# 固定報告與健檢規則

`node scripts/report.mjs --config report-config.json` 每次由同一模型輸出 health.html、report.md、health.json。所有路徑設定相對設定檔位置；repo 由 map 取得。
設定範例：

```json
{"maps":[{"path":"map.json","role":"production"},{"path":"tests.json","role":"tests"}],"outDir":"report","title":"查線健檢","blocks":[{"name":"核心","match":["src/**"],"kind":"production"}],"notes":"notes.json"}
```

maps 至少一份 production；每份必須同 repo、commit、工具版本且 readOnly PASS。輸出不得覆寫輸入或寫入受查 repo。blocks 依宣告順序第一個符合者；kind 只接受 production、prototype、experiment、plan、tools、tests、docs。未宣告依第一層資料夾分組，src 下再一層；未匹配檔案也以此分組。未宣告的區塊 kind 為 production（明顯 tests／docs 目錄除外），不從命名猜 prototype。
輸出包含報告設定的內容 SHA-256，以及每份 derive-map 的 configurationSha256、檔案 SHA-256。

## Markdown 與完整技術資料

目前 report.md 主體是維修單，附 health.json 與原始執行證據連結；規則見 [maintenance.md](maintenance.md)。HTML 主畫面也以維修單為主，舊統計與完整技術資料保留在展開區及 JSON。
舊 renderLegacyMarkdown 函式仍保留九節格式供相容性檢查：範圍與版本、入口、統計、斷線、怪異、只有測試在用、沒人用、工具限制、可重跑命令。它不是目前 CLI 的預設 Markdown。
每個觀察項目保留可讀的檔案與行號；缺定位明列未知。health.json 與 HTML 內嵌的原始統計使用同一份模型，自測核對兩者一致。

## 自動判定（靜態，不代表實跑）

- 正式路線檔數：production maps 的 closures.files 聯集，含被讀取資料；不只計 production kind。
- 只有測試在用：tests 閉包聯集扣除正式閉包，再排除 tests kind／測試檔，僅計程式副檔名。
- 沒人用：inventory 扣除全部選定閉包，再排除測試檔；只計 .mjs .js .cjs .ts .tsx .gs .html .css .py；設定檔（例如 *.config.*、config.*）、lock、圖片、Markdown 均排除。兩類按區塊合併卡片。
- 問題數字以正式閉包為母體；測試與 inventory 發現的限制另列，避免把測試故意讀取的缺失輸出當正式斷線。
- 斷線：字面本地 import／讀檔／framework 路徑未在 inventory，而且沒有字面 writer 或其他同檔名來源。套件、計算式、不可讀或缺定位皆為工具限制。
- 打包後才有：缺失目標與 derive-map endpointTable 的 literalTarget 相同；GAS HtmlService 的短名稱允許同檔名 HTML 對應，保留 writer 的精確檔:行與候選字樣。不證明打包已執行。
- 可能靠轉址接上：缺失 import 目標的同檔名檔案在 repo 別處，且 derive-map DATA_READ 邊以字面路徑讀入該檔；列出讀者檔:行。這是靜態候選，不斷言伺服器已轉址。只有同名但無讀取證據者列工具限制，不判斷斷線。
- 正式程式依賴非正式區塊：正式閉包中的 production kind 檔案引用 prototype／experiment／plan kind 檔案；每個來源、行、目標各計一項。DATA_READ 也屬引用，不能為符合樣稿數字而排除打包引用。
- 相同來源／類別／目標的多處缺口合併一張卡，保留全部行號；模組連線依 kind、來源、行、目標去重再按有向區塊配對加總。
- CORE_PIN_CLOSURE_MISSING 只提供缺失目標且 line:null；報告以現有詞法 tokens 找 closure 內相對 import 的原始定位，找不到列工具限制，絕不捏造行號。
- 計算式、framework 多義、一般缺口、未完成讀取與 parser 限制都不納入斷線／怪異數字。422／430 一類條件運算式不拆猜字面結果。
- writer 表只掃 derive-map 已覆蓋檔；報告對 inventory 內其餘程式補用相同 writerCandidates 靜態掃描，來源另標明。無法讀取時保留限制，不當缺失。

## 線索與推測

每張卡／區塊收集相關檔開頭註解與定位前後五行的註解，引用原文與行號；同資料夾或上一層 README.md 的標題與第一段附檔:行。不存在就省略。註解是詞法抽取，字串內類似註解文字不視為註解；不從註解推導行為。
notes.json 格式：`[{"target":"檔:行或區塊名","reason":"...","sources":["檔:行"]}]`。sources 必須非空且每個來源可讀、行號存在；否則不顯示並記拒收原因。腳本不生成推測。
風險與建議是各分類的通用檢查方向，不宣稱已發生故障。靜態零斷線不等於系統可執行。
大量群組、問題與限制用折疊清單；淺／深色離線可讀，SVG 隨容器縮放。交付前以本機瀏覽器檢查手機與桌面寬度。

## GAS 最近目錄候選

client 未受 manifest 專案或明示 scope 檔案目錄涵蓋時，逐層向 repo 根找第一個直接含 .gs 的目錄；只取該目錄 .gs 的頂層函式，不跨兄弟實驗目錄。
明示 scope 的合成 repo 根不代表擁有整個 repo 的 client。manifest 與明示 scope 優先，不被 fallback 覆寫。
GAS_CLIENT_CALL 邊保留 candidate:true、runtimeVerified:false、projectBasis:NEAREST_GS_DIRECTORY。名稱計算式與多義保持 gap。fallback 僅補 client 解析，不擴大原全域 scope／HtmlService 行為。
legacyIds["1.13.0"] 是同版身分投影；新邊才到達的 gap 不捏造歷史存在性。
