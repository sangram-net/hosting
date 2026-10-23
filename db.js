const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'greenhost.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS plans (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 category TEXT NOT NULL,
 description TEXT NOT NULL,
 monthly_paise INTEGER NOT NULL,
 yearly_paise INTEGER NOT NULL,
 features_json TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 plan_id TEXT NOT NULL REFERENCES plans(id),
 billing_cycle TEXT NOT NULL CHECK(billing_cycle IN ('monthly','yearly')),
 amount_paise INTEGER NOT NULL,
 currency TEXT NOT NULL DEFAULT 'INR',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','cancelled','provisioning','active','suspended')),
 razorpay_order_id TEXT UNIQUE,
 razorpay_payment_id TEXT UNIQUE,
 provider_reference TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 paid_at TEXT
);
CREATE TABLE IF NOT EXISTS payment_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event_key TEXT NOT NULL UNIQUE,
 event_type TEXT NOT NULL,
 order_id INTEGER REFERENCES orders(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
const plans = [
 {id:'web-starter',name:'Website Starter',category:'Website Hosting',description:'For personal sites, portfolios and small business pages.',monthly:115000,yearly:1150000,features:['1 website','10 GB SSD storage','Free SSL','Daily backups','Email support']},
 {id:'web-growth',name:'Website Growth',category:'Website Hosting',description:'More room for growing websites and small shops.',monthly:249000,yearly:2490000,features:['5 websites','50 GB SSD storage','Free SSL','Daily backups','Priority support']},
 {id:'vps-pro',name:'VPS Pro',category:'VPS Hosting',description:'A flexible virtual server for developers and production workloads.',monthly:499000,yearly:4990000,features:['2 vCPU (illustrative)','4 GB RAM (illustrative)','80 GB NVMe (illustrative)','Root access when provisioned','Firewall controls']},
 {id:'backend-scale',name:'Backend Scale',category:'Backend Hosting',description:'Deploy APIs and backend services with a managed workflow.',monthly:799000,yearly:7990000,features:['Node.js/API workload','Managed deployment workflow','Environment variables','Logs and health status','Database-ready architecture']},
 {id:'cloud-enterprise',name:'Cloud Enterprise',category:'Cloud Hosting',description:'A premium plan for higher-demand projects and teams.',monthly:1000000,yearly:10000000,features:['Priority provisioning','Expanded resources','Advanced monitoring','Priority support','Custom deployment review']}
];
const insert = db.prepare(`INSERT OR IGNORE INTO plans (id,name,category,description,monthly_paise,yearly_paise,features_json) VALUES (@id,@name,@category,@description,@monthly,@yearly,@features)`);
for (const p of plans) insert.run({...p,features:JSON.stringify(p.features)});
module.exports = db;
