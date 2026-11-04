# 花漾生活 Flower Life

花卉電商示範專案：Express 提供 REST API 與 EJS 頁面，資料存於本機 SQLite。付款採綠界 ECPay AIO，localhost 收不到通知，須按「查詢付款狀態」驗證。

**技術棧**：Node 20+、Express 4、better-sqlite3、JWT、EJS、Vue 3、Tailwind 4、Vitest。

## 快速開始

```bash
npm install
cp .env.example .env   # 設定 JWT_SECRET
npm start              # localhost:3001
npm test
```

管理員：`admin@hexschool.com`／`12345678`。測試與開發共用 `database.sqlite`；重置請刪 `database.sqlite*`。

## 文件

[詳細版](./reference/README.md)・[架構](./ARCHITECTURE.md)・[開發](./DEVELOPMENT.md)・[功能](./FEATURES.md)・[測試](./TESTING.md)・[日誌](./CHANGELOG.md)・[計畫](./plans/)
