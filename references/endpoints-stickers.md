# 終點區塊與可重跑貼紙

## 由終點反推

先做終點表：endpointId、實際路徑／模板、store 身分、寫法
（append、create-only、replace、transaction）、writer、reader、來源定位。
由寫入函式向上追入口與呼叫條件，填根 → caller → writer → endpoint；
同時記來源事實、派生投影、通知／收據，不混成單一「資料」。

不同區塊寫同一個正規化終點，列為漏水點；列出兩條寫入鏈、順序／所有權證據。
相同 basename 但不同 instance/library/release 根仍是不同終點。
計算路徑無法唯一解析時記 UNKNOWN，不把不確定的碰撞當成已證明的競爭。

可用下表交付：
| endpointId／實際目標 | 根與寫入鏈 | 寫法／所有者 | reader | 共寫證據 | 限制 |
|---|---|---|---|---|---|
| 逐項填真實 store | 檔:行 → 函式 → 檔:行 | append 等 | 檔:行 | 兩條鏈或無已知共寫 | UNKNOWN 原因 |

若使用 Mermaid，節點以 endpointId 定義區塊；目錄只作定位標籤。

## 貼紙

貼紙必須是一條「已驗證且有指令能重新檢查」的宣告：
1. 寫明 predicate，例如「根集合 R 的靜態閉包等於此 commit 的獨立集合 B」。
2. 保留根、baseline 來源/hash、適用 commit、工具版本/hash、解析及讀取範圍。
3. 提供命令、預期集合差異為空及 gaps 0；不用固定檔數。
4. 實跑並保存 exit code／stdout／stderr，驗證範圍外的部分保持 UNKNOWN。
5. 沒跑、未校準、已知 gaps 或只靠合成測試時，只能交貼紙提案。
6. 唯讀任務不安裝 CI、不更新 pin。安裝是另外一項有授權的變更，不新增等人決定的流程。

architecture fitness function 是現有工具類型，例如 dependency-cruiser、tach、ArchUnit。
此處只介紹概念，不安裝或新增 npm 相依。
architectural coverage（Fraunhofer SAVE）在本需求單提供的背景中是研究原型，
沒有可直接採用的成品；離線工作未核實後來產品狀態，不以此推薦購買或部署。
