# 鏈卡：一個問題，一條有錨點的鏈

先依問題讀碼，不要求先填 file／line／expect／hash／紀錄根。讀到可支撐結論的來源後再填卡；工具只核對引用，不替 agent 判斷語意。

固定五節：①讀的是哪一份（repo、commit／版本指標、實際在跑版本；未查就寫 UNKNOWN）②鏈（A → B → C，每站一個錨點）③衝突點（按嚴重度，每點現象、錨點、方向）④查過、不是問題（附錨點）⑤驗證與未知（命令／結果、UNKNOWN 五欄）。

```text
node scripts/chain-card.mjs --init --question "為何未寄出？" --root /repo-copy --out /evidence/input.json
node scripts/chain-card.mjs --config /evidence/input.json --out /evidence
```

`--init` 只產可填骨架，不是交付；root 用絕對路徑，輸出需在受查根外。產卡輸出固定為 chain-card.md、chain-card.json；未指定 --out 時採 outDir 或設定檔所在目錄。錨點相對 root，只讀一般檔案，不跟隨連結。
錨點只填 `{file,line,expect}`，expect 必須是該行包含的非空字串；工具從讀入位元組計算 sha256。原行不符且 ±3 行內只有一處符合才校正，標「行號已校正」並保留 requestedLine；多處或找不到則 ANCHOR_MISMATCH，在卡頭列出，仍輸出完整卡。
鏈與「查過不是問題」缺錨點列 ANCHOR_MISMATCH；衝突可無錨點，但標「無錨點：推論」。嚴重度 critical／high／medium／low 依序排序，其餘放最後。可用 anchors 陣列附多處；單一錨點用 anchor。
未知的 next 用 `{action,cost}`；六種類別、標示與補查方法見[UNKNOWN 對策](unknown-playbook.md)。工具標示不等於已完成補查。

## 完整小範例（虛構 repo）

假設 `/repo-copy/main.mjs` 第 1 行是 `export const send = () => queue();`，`queue.mjs` 第 1 行是 `export const queue = () => "WAIT";`，`POLICY.md` 第 1 行是 `Requests send immediately.`。

```json
{
  "question": "為何呼叫 send 仍等待？",
  "root": "/repo-copy",
  "version": {"repo": "/repo-copy", "commit": "UNKNOWN（範例無 Git）", "running": "UNKNOWN（未觀察部署）"},
  "chain": [
    {"label": "send", "anchor": {"file": "main.mjs", "line": 1, "expect": "queue()"}},
    {"label": "queue 回 WAIT", "anchor": {"file": "queue.mjs", "line": 1, "expect": "WAIT"}}
  ],
  "conflicts": [{
    "severity": "medium", "phenomenon": "文件稱立即送出，程式卻回 WAIT", "direction": "確認立即送出的需求，再修文件或佇列行為",
    "anchors": [{"file": "POLICY.md", "line": 1, "expect": "immediately"}, {"file": "queue.mjs", "line": 1, "expect": "WAIT"}]
  }],
  "cleared": [{"finding": "send 確實呼叫 queue", "anchor": {"file": "main.mjs", "line": 1, "expect": "queue()"}}],
  "verification": [{"check": "讀回三個來源錨點", "status": "PASS", "result": "文字相符；未執行服務", "anchor": {"file": "queue.mjs", "line": 1, "expect": "WAIT"}}],
  "unknowns": [{
    "question": "需求是否允許等待？", "class": "owner-only", "cause": "文件與程式不一致，缺需求決定",
    "tried": "已對照立即送出宣告與 WAIT 回傳", "next": {"action": "請 Owner 決定允許的等待條件", "cost": "Owner"},
    "understanding": "推論：可能原本就要排隊；若需求明示同步送達就推翻此解釋"
  }]
}
```

輸出保留五節、每個錨點的核對結果與 hash；摘要只表示引用核對結果，程式／部署是否正確仍依各筆驗證判斷。

鏈卡回答一個問題；[體檢卡](check-card.md)盤點整個 repo 的入口、輸出、副作用、費用與宣告。兩者共用 UNKNOWN 格式；需要全面盤點才切到 [audit](audit.md) 或五步細查，原報告章節不重排。
