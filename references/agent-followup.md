# UNKNOWN 交給 agent 追路線

當工具已指出跳點，但目標取決於呼叫者、宣告、設定或執行時資料，才用這條路徑。先選會影響目前問題的功能路線，把共用入口、設定或 dispatcher 的相關 finding 放在同一工單；不要一個 UNKNOWN 派一個 agent，也不要把尚未查過稱為查線極限。單一 agent 也可完成，工具不綁模型或代理服務。

## 形成路線工單

先讀入口與呼叫處，再提供 `trace-boundary-v1` 報告和明示分組。本版不自動猜路線；已有 derive-map gap 時直接沿用 [推論與執行對帳](inference-runtime.md)，不要混用兩套 ID 或把數量相加。

```text
node scripts/agent-followup.mjs prepare --config routes.json --out packet.json
```

`routes.json` 欄位：

- `report`：既有 boundary JSON 的絕對路徑。
- `allowedRoots`：本輪可讀的原碼、宣告、設定與證據根。只列此次需要的根。
- `routes`：每筆有 `id`、`question`、`entry:{file,line,expect,sha256}` 與 `findingIds`。entry 的 file 為絕對路徑；findingIds 使用原報告 ID。

工具核對來源與錨點，輸出選取的工單及未分派數量；不執行目標程式、不呼叫模型。輸出必須是原碼根外的新檔。若來源漂移，先重建受影響報告；不要把舊報告的 hash 改成新值湊通過。

## Agent 要交回什麼

把工單、可讀根、問題與輸出位置交給 agent。要求它追「入口 → 值從哪裡來 → 目標 → 結果由誰讀」，搜尋相關呼叫者，不從函式或檔名推定語意。

依缺口選最小方法：固定引用讀原碼；安裝／設定引用用 version-chain；歷史工作用 record-census／trace-one-job；確實需要新執行證據才用 water-source 與 gap-reconcile。設定已指出具名檔案時繼續讀回，不能只停在「參數未知」。同時保留該設定或輸入的適用範圍，不能將一個樣本當成所有呼叫。

結果 JSON：

```json
{
  "packetSha256": "工單檔案的 SHA-256",
  "routeId": "工單內的路線 ID",
  "findings": [{
    "id": "原 finding ID",
    "assessment": "source-derived",
    "explanation": "具體值如何從入口到達目標，分支條件是什麼",
    "evidence": [{"file": "/authorized/source.mjs", "sha256": "檔案 SHA-256", "line": 12, "expect": "該行原文"}],
    "remaining": "這份證據沒有證明的部分；若仍未知，寫缺什麼及下一個可查來源"
  }]
}
```

assessment 為 `source-derived`、`config-derived`、`runtime-observed` 或 `unknown`。證據可用 `line`＋`expect` 定位原文，或 `pointer`＋`equals` 定位 JSON 值。每個非 unknown 主張至少給一個可讀、hash 綁定的證據。執行主張應指向捕捉到的呼叫位置、目標與結果，不能只附 agent 自寫的成功報告。省略的 finding 是未回覆，不是解決。

## 收回與覆核

```text
node scripts/agent-followup.mjs collect --config collection.json --out collected.json
```

`collection.json` 為 `{packet:絕對路徑,resultFiles:[結果檔絕對路徑]}`。工具重查原報告、來源及證據，保留有效部分，將過期、重複、越界或不符的項目與缺回覆分列。完整結果在檔案，CLI 只印摘要。

**機械核對成功只表示引用可讀且相符。** 它不判斷 explanation 是否由 evidence 支持，不自動把 agent 的 runtime-observed 主張升格，不改寫原 UNKNOWN。管理者還要讀支撐主張的實際錨點／JSON 值，檢查是否為同一次執行、同一條邊與相同版本；缺少語意或執行支持就保留未知，或在同工單補證據。

交付時列：本輪選取數、已回覆數、引用核對結果、管理者確認的來源／設定／執行證據及剩餘未查數。每個 UNKNOWN 都依[對策表](unknown-playbook.md)填 class、cause、tried、next、understanding，交代目前最佳解釋及可推翻的觀察。便宜且在授權內能補的先補；需要付費、真帳號或 Owner 判斷的才留待處理；失敗或資料遺失明列限制，不能用猜測補成已知。相同情境最多三次，沒有新假設不重跑，替身不升格為真實使用。
