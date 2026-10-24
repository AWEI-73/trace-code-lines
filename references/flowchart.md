# 按需流程圖

只有使用者要求才做；不能為產健檢報告自行加入。
1. 選一條路線，先以 derive-map 的選定 root closure 取得檔案清單，記錄 repo、commit、map 與 root。
2. agent 只讀該閉包的檔案，寫 flow.json：steps 每步有 id、白話 label、source（查線／註解／文件／推測）及 anchor:{file,line,expect}；arrows 每條有 from、to、白話 when。推測也必須有 anchor，不以推測代替程式條件。
3. report 設定加入 `"flow":"flow.json"`；flow.json 的 routeRoot 必須精確對到 production map 中一條 root。腳本逐步核對檔案是否在該閉包、行號是否存在、該行是否含非空 expect；每個 anchor 產 PASS／FAIL 與原因。
4. 同次產出 flow.html、flow-checked.json；FAIL 紅框，頁頂列失敗數。任何 FAIL 不能宣稱全圖驗證通過。HTML 自帶 SVG、條件與來源清單，不連網。
5. agent 人工複核箭頭與分支語意；anchor PASS 只證明定位與字串，不能證明業務解讀正確或曾執行。不得因改行號而跳過語意讀取。

```json
{"title":"範例路線","routeRoot":"src/main.mjs","steps":[{"id":"start","label":"接收請求","source":"查線","anchor":{"file":"src/main.mjs","line":1,"expect":"export"}}],"arrows":[]}
```

腳本拒收重複 id、未知箭頭端點、空條件與非法來源標記。每一步在圖中可點到完整錨點與出向條件。支援分支與回路，不自動推導順序。

## 1.14.1 閱讀版：兩層主圖與白話規則

原有 `steps`、`arrows`、`anchor` 繼續有效；沒有新增欄位的舊檔仍可讀。舊檔超過十二步時，主圖先顯示前十二步，完整細步驟和回路仍在細節，並顯示限制。要呈現正式的兩層圖，請提供：

- `main.nodes`：一到十二個主節點。每個都有 `id`、`label`、`type`；種類是 `step | decision | end`。標題最多二十字，不准使用英文術語、程式名稱或識別字。可加一行白話 `note` 補充必要條件。
- `main.arrows`：主節點之間的 `from`、`to`、`when`。判斷節點恰有兩個不同出口，標示「是／否」或短句。主圖須有唯一入口、全部節點可到達，而且沒有回路。回路留在第二層。
- 終點另加 `tone: answer | ask | handoff | decline`，分別用綠、藍、橘、灰表示回覆、補問、轉人工、拒答。
- 原有每個細步驟增加 `group`，精確指向所屬主節點；也可加 `type` 與終點 `tone`。每個主節點至少要有一個細步驟提供來源。
- 原有錨點、完整箭頭條件都保留。主圖按最長步驟深度分層，同層依上游位置與分支順序排列；自行產生平滑曲線與圖形，不載入外部程式庫。
- 點選主節點或用鍵盤啟動連結，會展開該組細節。檔名、行號、預期字串、通過或失敗的原始記錄、程式片段與原文只放在細節裡。窄螢幕改成直向縮排與色條。

```json
{
  "routeRoot": "src/main.mjs",
  "main": {
    "nodes": [
      {"id":"check","label":"資料齊全嗎？","type":"decision"},
      {"id":"reply","label":"回覆","type":"end","tone":"answer"},
      {"id":"ask","label":"補問","type":"end","tone":"ask"}
    ],
    "arrows": [
      {"from":"check","to":"reply","when":"是"},
      {"from":"check","to":"ask","when":"否"}
    ]
  },
  "steps": [
    {"id":"validate","group":"check","type":"decision","label":"檢查輸入","source":"查線","anchor":{"file":"src/main.mjs","line":1,"expect":"validate"}},
    {"id":"send","group":"reply","type":"end","tone":"answer","label":"送出結果","source":"查線","anchor":{"file":"src/main.mjs","line":2,"expect":"send"}},
    {"id":"clarify","group":"ask","type":"end","tone":"ask","label":"請補資料","source":"查線","anchor":{"file":"src/main.mjs","line":3,"expect":"clarify"}}
  ],
  "arrows": [
    {"from":"validate","to":"send","when":"資料齊全"},
    {"from":"validate","to":"clarify","when":"資料不全"}
  ]
}
```

兩份閱讀版共用 `assets/plain-language.json`。未提供安全白話名稱的區塊用中性編號，原始名稱仍在細節，不從檔名猜功能。已知分類、狀態與卡片的說明、風險、建議均由轉譯表提供。正式程式讀取非正式檔案，只有在「來源為正式入口，且有產檔證據」時才歸為打包帶入；否則仍列為一般引用問題。

健檢主畫面的怪異數以合併卡片計數，依「來源檔、目標區塊、問題種類」合併；原始統計仍完整保存在細節與原本的資料檔。合併前後的計量單位不同，必須同時說明，不能改寫原始發現。群組卡列出該區塊的全部檔案；大量區塊保留完整內容，折疊後續項目以維持可閱讀性。

位置核對的通過不等於流程語意或執行通過。不能為了讓主圖簡單而省掉會改變結果的重要前提；前提不符時，以實際原始碼為準，記錄偏差。
