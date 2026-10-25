# 反查入口與回退提示

只讀地圖與 repo，不執行受測程式；Git 僅讀 HEAD 與 status，設 GIT_OPTIONAL_LOCKS=0。

~~~text
node scripts/reach.mjs --map /output/trace-map.json --target src/helper.mjs --target src/legacy.mjs
node scripts/reach.mjs --map /output/trace-map.json --targets-file /output/targets.json --out /output/reach.json
~~~

目標可用 repo 相對路徑或 repo 內絕對路徑；拒絕跳出與 symlink。targets-file 可為 JSON 字串陣列或每行一路徑的 UTF-8 檔，與重複 --target 合併後去重。
stdout 僅有 JSON。--out 寫完整結果，stdout 留 {schema,status,outputs:{reach:absolutePath}}；輸出必須是 repo 外新檔，不覆寫輸入。輸入錯誤 exit 1；exit 0 仍需讀 status 與每目標缺口。

## 輸出與來源

- roots：從 closures[].files 反查入口，依 population 分組。優先用地圖的 population；舊地圖未保留分類規則，依 fixtures/tests/docs 路徑與程式副檔名啟發式分組，rootDetails.populationBasis 明列依據，不冒充原分類。
- onlySelfRoot：所有母體合計只有自己入口時為 true。
- importers：直接邊只取自地圖 edges，保留 kind/path/line/specifier/targets。舊邊沒有名稱，因此以該行與 specifier 定位 ESM 宣告，補 names 的 imported/local 別名與 sourceSha256；未支援的 CJS/Python/dynamic import 名稱明列 UNKNOWN。
- callSites：importer 內的名稱詞法使用，包含函式呼叫 CALL 與值引用 REFERENCE，附行、欄、原行 snippet 及 UTF-8 SHA-256。不是完整呼叫圖。
- guarded：只提示 ??/|| 右側、三元式假分支、if (!...) 本體的 FALLBACK_GUARD，條件真假一律 UNKNOWN，交給 agent 讀宣告或設定。不推論提前 return 的支配關係或跨函式回退。
- mapHead/currentHead、mapSource.sha256、readOnly：版本不同、dirty repo、讀取或回讀異常會降級 UNKNOWN。

| verdictHint | 限定意義 |
| --- | --- |
| ORPHAN_CANDIDATE | 地圖內沒有 source 入口，或 source 只有目標自己；不代表可刪除 |
| REACHABLE | 地圖有其他 source 入口 |
| REACHABLE_ONLY_BEHIND_GUARD | 所列 source importer 使用都有詞法 guard，不代表模組載入或副作用受 guard 控制 |
| UNKNOWN | 有版本、錨點、名稱、型別、再匯出或讀取缺口，gaps 附原因 |

## 限制

地圖的入口選擇與邊不保證完整；mapGapCount 揭露相關閉包缺口數，不冒充目標專屬異常。詞法分析跳過註解、字串與 regex；樣板內插、複雜遮蔽、callback、別名傳遞與跨檔資料流仍可漏報或誤報。結果只是交給 agent 讀碼的證據索引，不做刪除、修復或採納決定。
