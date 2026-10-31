# 刪除影響

刪檔或改名前執行 `node scripts/deletion-impact.mjs --config deletion.json`。把已安裝產物、清單、收據與紀錄列為 repo 外、明確授權只讀的 `retainedRoots`；不自行猜外部根。指令不寫檔，stdout 是全量 JSON；`--help` 不需設定且 exit 0。

~~~json
{
  "repo": "/work/project",
  "paths": [
    "src/old.mjs"
  ],
  "retainedRoots": [
    {
      "path": "/work/installed-records",
      "label": "installed"
    }
  ],
  "unusedExclusions": {
    "historyDirectories": [
      "docs/history"
    ],
    "staticDirectories": [
      "public"
    ],
    "conventionLoaded": [
      "**/hook.py"
    ]
  },
  "limits": {
    "maxFileBytes": 4194304,
    "maxTotalBytes": 268435456,
    "maxFiles": 100000,
    "maxEntries": 250000,
    "maxMatches": 100000
  },
  "display": {
    "maxGroupsPerCategory": 20
  }
}
~~~

`paths` 與 `gitRange: "<base>..<head>"` 擇一。git 取刪除檔與 `-M` 識別改名的舊路徑；複製不算刪除。相對 repo／留存根以設定檔所在目錄解析。根的 label 必須唯一，且根之間與 repo 不得互相包含。

逐刪除路徑列兩層：repo 內不限副檔名的字串位置，分程式、資料、宣告歷史；留存物依根與檔分組，附檔數與前三錨點。`unusedExclusions` 沿用 1.21 宣告：`historyDirectories` 分為歷史；`staticDirectories`、`conventionLoaded` 標記宣告但不藏掉引用。另可用 `exclude` glob 排除各根內相對路徑，每個略過項均列明；`.git` 也明列為略過。

留存物命中一律標示「要處理：留存物仍引用；需執行證據確認新版仍接受它」。不推論沒事或會壞。沒有根、缺根、無法讀取或掃描不完整時保留 UNKNOWN 缺口。`NO_RETAINED_MATCH` 只是已讀母體未見字面命中，不是可刪除或相容證明。

單檔、總 bytes、檔數、目錄項與命中數的上限如例，均為正整數，由所有根共用；先照宣告順序讀留存根，再讀 repo。超限檔、未走子樹與目錄剩餘區段、未搜完命中都在 `scopes[].skipped`；`stats.limitExceeded` 明示超限。bytes 計實讀內容，包含讀後判定二進位的檔；目錄列舉與 git 中繼資料另計。讀取前後核對檔案身分、大小與修改時間。

不跟隨 symlink 或其祖先；含 NUL／控制字元、非 UTF-8 檔明列略過。不支援 UTF-16、只寫檔名或計算式路徑。直接搜尋區分大小寫的子字串，正斜線、Windows 與 JSON 跳脫的反斜線統一比對。column 對應統一後文字；全量位置在 JSON，片段最多 240 字元，附截短標記與完整行 hash。

接入既有報告：在 `report.mjs` 設定加 `deletionImpact` 物件，填同一選擇與留存根，repo 由 map 提供，可繼承頂層 `unusedExclusions` 與 `display`。`check-card.mjs` 未填 repo 時使用 `root`。子設定的相對根以 CLI 設定檔所在目錄解析。兩者都加 Markdown／HTML 章節與完整 JSON，不改原判定與計數；輸出必須在受查根外。

畫面沿用 1.21 同判定／原因／檔案分組；留存根各自分組，每類預設 20 組，依出現數排序，附前三錨點與件數。省略組數明列，全量連到 JSON。這是輔助工具，不執行受查程式，不替人決定。

[English](deletion-impact.en.md)
