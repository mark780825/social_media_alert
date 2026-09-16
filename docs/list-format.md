# 警示清單 JSON 格式

匯入、匯出與訂閱都使用同一種格式。檔案最外層可以是物件或直接是陣列：

```json
{
  "name": "my-list",
  "version": 1,
  "entries": [ /* ... */ ]
}
```

```json
[ /* 直接放項目陣列也可以 */ ]
```

## 項目欄位

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `platform` | `"facebook"` \| `"threads"` \| `"any"` | 否 | 預設 `any`（兩個平台同名帳號都會命中） |
| `handle` | string | 至少填一個識別欄位 | 帳號名稱，可帶 `@`，大小寫不拘；也可直接貼完整網址 |
| `profileId` | string | 至少填一個識別欄位 | `profile.php?id=` 後面的數字 ID |
| `groupId` | string | 至少填一個識別欄位 | Facebook 社團代號 |
| `name` | string | 否 | 顯示名稱，會出現在警示卡標題 |
| `level` | `"danger"` \| `"warning"` \| `"info"` | 否 | 預設 `warning`；對應「高風險 / 需留意 / 提醒」 |
| `reason` | string | 否 | 警示原因，會顯示在警示卡與貼文標記上 |
| `tags` | string[] | 否 | 分類標籤，例如 `["投資詐騙"]` |
| `url` | string | 否 | 參考網址；若沒填 `handle` / `profileId`，會嘗試從這裡解析 |
| `id` | string | 否 | 唯一識別碼，匯入時若未提供會自動產生 |
| `source` | string | 否 | 來源標記，匯入時預設 `user`，訂閱清單會被覆寫為 `subscription:<網址>` |
| `addedAt` | ISO 8601 string | 否 | 建立時間，未提供時自動填入 |

`handle` 與 `profileId` 在儲存前會被正規化：去掉 `@`、尾端斜線與空白，帳號轉小寫，ID 只保留數字。

## 範例

```json
{
  "name": "my-list",
  "version": 1,
  "entries": [
    {
      "platform": "facebook",
      "handle": "example.fake.shop",
      "name": "一頁式購物詐騙",
      "level": "danger",
      "reason": "超低價商品、只收私訊下單、無實體店家資訊",
      "tags": ["購物詐騙"]
    },
    {
      "platform": "facebook",
      "profileId": "100001234567890",
      "name": "冒用身分的假帳號",
      "level": "warning"
    },
    {
      "platform": "threads",
      "handle": "@example_rumor",
      "level": "info",
      "reason": "內容多為未經查證的轉述"
    }
  ]
}
```

## 訂閱清單注意事項

- 訂閱網址必須回傳上述格式的 JSON，且允許跨來源讀取（CORS）。
- 訂閱來的項目在設定頁是唯讀的，只能整批更新或清除。
- 自動更新間隔最短為 30 分鐘（設定值小於 0.5 小時會被拉高）。
