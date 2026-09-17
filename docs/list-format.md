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
| `nameMatch` | string[] | 至少填一個識別欄位 | 要比對的粉專顯示名稱，查不到網址代號時使用；只在帳號頁比對，不在動態牆比對 |
| `name` | string | 否 | 顯示名稱，會出現在警示卡標題 |
| `level` | `"danger"` \| `"warning"` \| `"info"` \| `"safe"` | 否 | 預設 `warning`；對應「高風險 / 需留意 / 提醒 / 已澄清」。`safe` 代表「已查核、與被點名對象無關」，只會顯示綠色提示，不發警示，也不受最低顯示等級影響 |
| `reason` | string | 否 | 警示原因，會顯示在警示卡與貼文標記上 |
| `tags` | string[] | 否 | 分類標籤，例如 `["投資詐騙"]` |
| `url` | string | 否 | 參考網址；若沒填 `handle` / `profileId`，會嘗試從這裡解析 |
| `id` | string | 否 | 唯一識別碼，匯入時若未提供會自動產生 |
| `source` | string | 否 | 來源標記，匯入時預設 `user`，訂閱清單會被覆寫為 `subscription:<網址>` |
| `addedAt` | ISO 8601 string | 否 | 建立時間，未提供時自動填入 |

`nameMatch` 比對時會忽略空白與全形／半形差異（例如「反萊豬 我＋1」與「反萊豬我+1」視為相同），
但必須整個名稱相符才算命中，不做部分包含比對，以免「靠北醫生」波及其他「靠北 XX」粉專。

`handle` 與 `profileId` 在儲存前會被正規化：去掉 `@`、尾端斜線與空白，帳號轉小寫，ID 只保留數字。

## 只有名稱、沒有網址代號時

公開資料常常只留下粉專名稱。這種項目用 `nameMatch`：

```json
{ "platform": "facebook", "nameMatch": ["靠北醫生"], "level": "danger", "reason": "DSET 具名" }
```

比對時會拿頁面的 `<title>`、`<h1>` 與 `og:title` 來對。要留意兩件事：

1. **同名粉專可能不是同一個** —— 命中時警示卡會標明「這是用名稱比對的」，請自行確認透明度資訊。
2. **動態牆上不做名稱比對** —— 只有進到該粉專頁面時才會提醒，因為動態牆上的同名文字太容易誤判。

若之後查到網址代號，建議補上 `handle` 或 `profileId`，比對會更精確。

## 避免同名誤認：safe 等級

```json
{ "platform": "facebook", "handle": "i.Taoyuan", "level": "safe",
  "reason": "自介無 LIFE 標記，與 Taoyuan.Info 不是同一個粉專" }
```

`safe` 項目逛到時顯示綠色「已澄清」提示，不會被當成警示，也不會在動態牆上標記貼文。

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
