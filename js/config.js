// ============================================================
// 網站設定：部署到 GitHub Pages 後，通常只需要改這個檔案
// ============================================================

// Apps Script「部署 → 網頁應用程式」取得的 /exec 網址（見 部署說明.txt）
const PROD_API_URL = 'https://script.google.com/macros/s/AKfycbyNZnhlKR0wF2sZXWGZESog7gBsXkZ_xlFOZNzXvqW3IsMBsQDaUuHvL-J2Xk0wYJ5pCA/exec';

// 在本機（localhost）開啟時改用 dev/server.js 的模擬後端，不會動到正式資料
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const API_URL = IS_LOCAL ? '/api' : PROD_API_URL;

// 圖鑑類別（順序＝畫面上的順序）。要加類別就加一行；
// 改名或刪除類別不會動到舊資料，舊資料會以原本的類別名稱另外列出。
const CATEGORIES = [
    { name: '食靈', icon: '🧚' },
    { name: '時裝', icon: '👗' },
    { name: '卡牌', icon: '🃏' },
    { name: '作物', icon: '🌱' },
    { name: '養殖', icon: '🐔' },
    { name: '海產', icon: '🐟' },
    { name: '食材', icon: '🧺' },
    { name: '料理', icon: '🍲' },
    { name: '裝飾', icon: '🏡' },
    { name: '其他', icon: '📦' }
];

// 稀有度（由低到高）：name＝存進資料的值、short＝圓章上的字、color＝圓章底色（取自遊戲內圓章）
const RARITIES = [
    { name: '凡品', short: '凡', color: '#86cc45' },
    { name: '普品', short: '普', color: '#62bdea' },
    { name: '珍品', short: '珍', color: '#a175f4' },
    { name: '華品', short: '華', color: '#f4a93a' },
    { name: '仙品', short: '仙', color: '#e04443' }
];

// 圖鑑「來源」的選項（下拉選單，順序＝選單順序）。改這裡不會動到舊資料，舊值編輯時會保留
const SOURCES = ['等級解鎖', '活動', '食坊兌換', '食靈商店', '每週食材', 'VIP商店', '食靈禮包', '食材禮包', '時裝禮包', '食之密令', '累計儲值'];

// 登入狀態存在瀏覽器的 key
const SESSION_KEY = 'jieyou_session';
