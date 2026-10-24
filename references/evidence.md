# 引用漏斗與證據紀錄

本節四範圍搜尋與 TEXT_REFERENCE_ONLY／NO_REFERENCE_FOUND_IN_DISCLOSED_SCOPE 目前為手工流程，沒有自動漏斗 CLI。NODE_OPTIONS 字面旗標由 1.11.0 補出 RUNTIME_FLAG_REFERENCE；計算式與 env 傳遞仍手工。

## 四範圍搜尋

先從靜態零覆蓋候選取 basename、完整 repo 相對路徑；Python 模組可再查 stem。
用固定字串避免把點當 regex。保存本次查詢清單，從 Node 執行：

```js
const args = ['--json','--hidden','--no-ignore',
  '-g','!.git','-g','!**/.git/**','-F','-e',basename,'-e',relativePath,scopeRoot];
let run;
try {
  run = {exitCode:0, stdout:execFileSync('rg',args,
    {cwd:repo,encoding:'utf8',env:process.env,stdio:['ignore','pipe','pipe']}),
    stderr:''};
} catch (e) {
  run = {exitCode:e.status,stdout:String(e.stdout??''),stderr:String(e.stderr??e.message)};
}
```

按 repo → 發版根 → 使用者 skills → 已安裝快照依序執行，每次記完整 args。
大量候選可用 -F -f queries.txt 批次查；仍保留每候選 querySubset 與命中歸屬。
ripgrep 不存在時可用 Node 遞迴讀文字搜尋；保留相同範圍、排除與錯誤欄位，
不要為此安裝套件或等待人工選工具。

- exit 0：有命中；exit 1：在本次掃描內無命中；其他／stderr 的讀取錯誤：UNKNOWN。
- rg 預設不搜尋 binary、不跟隨 symlink；如未另補查，要列為限制。
- 排除候選本檔中的自我提及並計數，不能刪除其他檔的命中。
  自我 main guard 則是根證據，應回補根清單，不以自我提及一概忽略。
- 同名碰撞先保守記文字引用，讀上下文才解析實際目標。
- 批次結果保留 repo-relative 路徑及 scopeRoot；不同 snapshot 的同名檔不能合併。
- 找不到有效發版／安裝指標就記 UNKNOWN；不拿資料夾修改時間猜 active。
- 對已知 Profile，按安裝索引的 source.packRoot 精確對應 destination.snapshotRoot；
  記 contentHash／版本／installedAt。代表快照不等於目前啟用。
- 四範圍文字零命中後仍必做模板家族補查；某層缺目錄／權限就記缺口，
  有限結論只指完成的層。

## 第五道：計算路徑家族

用 rg 搜尋 new URL、import(、path.join、resolve、字串模板及目錄列舉；
對命中的完整表達式閱讀上下文，不只看一行。
以 既有走訪器 的 new URL 模板方式為例：

1. 記來源檔與行號，找到 import.meta.url 所指的模組目錄。
2. 將字面片段做路徑正規化並 regex escape，單一路徑片段插值轉成 `[^/]+`。
3. 和候選清單逐檔比對；保存原模板、轉換後 pattern、匹配 paths。
4. 若插值可能跨多層目錄、上溯或受外部資料控制，標 COMPUTED_OR_UNRESOLVED；
   上述單片段 pattern 沒命中不等於排除全部可能值。
5. 模板可產生某檔，只證明家族引用，不證明實際參數或執行。
   它應離開「未找到引用」清單，但仍可能保持靜態零覆蓋。

模板通向動態載入時用 DYNAMIC_COMPUTED；純讀檔／生成路徑模板沒有載入證據時
用 TEXT_REFERENCE_ONLY 並加 referenceKind=COMPUTED_PATH_TEMPLATE。
不要為了湊七級而把一般檔案讀取說成 dynamic import。

## 五條逃生路的核對方法

字面 import：自動走訪器解析到現存目標時，靜態 import 與字面動態 import 都會進入靜態閉包；手工補查的文字線索則另列證據，不能直接改寫既有地圖。
計算 import：保留表達式、可知基底與變數來源，未知目標不猜。
spawn／execFile：追 executable、argv、cwd、env；shell 字串只能算詞法候選，
除非上下文足以解開它。不要執行來源命令。
散文：找誰把該 Markdown 讀進模型上下文、文件中指令的目標與相對基底。
旗標：檢查 NODE_OPTIONS 組裝、--import/--require/--loader 的字面與計算參數，
再核對 env 真有傳入子行程；僅 NODE_OPTIONS 一詞不是 loader 的證據。
跨行組裝需讀完整陳述與呼叫點，不能只靠同一行 regex。

詞法掃描會抓到註解、生成程式字串、同名局部 require；保存並註明，
不要宣稱 AST 分析或完整執行圖。正向 runtime 證據只能來自另有授權且真的執行的觀測。

## 七個證據等級

| 等級 | 需要的定位證據 | 不能推出 |
|---|---|---|
| STATIC_IMPORT | 靜態 import/re-export 的來源行、specifier、目標 | 函式有呼叫、執行路徑有觸發 |
| DYNAMIC_LITERAL | import() 固定字串與解析目標 | 本輪執行過 |
| DYNAMIC_COMPUTED | 計算載入表達式、已知家族或未知參數 | 唯一目標、全部候選都會載入 |
| RUNTIME_FLAG_REFERENCE | 旗標與 loader 路徑、env/argv 傳遞鏈 | 本輪子程序真的啟動 |
| SUBPROCESS_ARG | executable、argv、cwd 到目標的鏈 | 子程序成功或執行了全部函式 |
| TEXT_REFERENCE_ONLY | 文字／配置／散文／模板的來源行 | 該命中確實指向本檔並執行 |
| NO_REFERENCE_FOUND_IN_DISCLOSED_SCOPE | 實跑搜尋、明列範圍、查詢、限制、無有效命中 | 沒有被使用、可以刪除 |

每個候選可保存：
```json
{
  "path": "src/example.mjs",
  "population": "source",
  "staticCoverage": 0,
  "calibration": "UNCALIBRATED",
  "confidence": "PROVISIONAL_STATIC",
  "evidenceLevels": ["TEXT_REFERENCE_ONLY"],
  "references": [{"scope":"repo","file":"guide.md","line":12,"kind":"prose"}],
  "scopeComplete": false,
  "unknownScopes": ["deployed-release"],
  "searchRuns": [],
  "templateChecks": [],
  "canProve": "找到文件文字引用",
  "cannotProve": "不能證明執行或可刪除"
}
```
以上是格式示例，不是可直接交付的實跑證據；searchRuns 應填真正的命令紀錄。
