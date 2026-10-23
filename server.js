require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { z } = require('zod');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || '';
if (isProd && JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET to a random secret of at least 32 characters in production.');
const razorpayReady = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && !process.env.RAZORPAY_KEY_ID.includes('replace'));
const razorpay = razorpayReady ? new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}) : null;

app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","https://checkout.razorpay.com"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:"],connectSrc:["'self'","https://api.razorpay.com"],frameSrc:["https://api.razorpay.com"],objectSrc:["'none'"],upgradeInsecureRequests: isProd ? [] : null}}}));
app.use(cookieParser());
app.use('/api/', rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:true,legacyHeaders:false}));
app.use(express.json({limit:'20kb',verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf)}}));
app.use(express.static(require('path').join(__dirname,'..','public')));

function signToken(user){return jwt.sign({sub:user.id,role:user.role},JWT_SECRET || 'development-only-secret-change-me', {expiresIn:'7d'});}
function auth(req,res,next){const token=req.cookies.gh_session; if(!token)return res.status(401).json({error:'Please sign in.'}); try{const payload=jwt.verify(token,JWT_SECRET || 'development-only-secret-change-me'); const user=db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').get(payload.sub); if(!user)return res.status(401).json({error:'Account not found.'}); req.user=user; next();}catch{return res.status(401).json({error:'Session expired. Please sign in again.'});}}
function admin(req,res,next){if(req.user?.role!=='admin')return res.status(403).json({error:'Administrator access required.'});next();}
function publicPlan(p){return {id:p.id,name:p.name,category:p.category,description:p.description,monthlyPrice:p.monthly_paise/100,yearlyPrice:p.yearly_paise/100,features:JSON.parse(p.features_json)};}
function publicOrder(o){return {id:o.id,planId:o.plan_id,planName:o.plan_name,billingCycle:o.billing_cycle,amount:o.amount_paise/100,currency:o.currency,status:o.status,createdAt:o.created_at,paidAt:o.paid_at};}

// Bootstrap the admin account from environment variables. Change the password before production use.
async function ensureAdmin(){const email=(process.env.ADMIN_EMAIL||'admin@example.com').toLowerCase(); const password=process.env.ADMIN_PASSWORD||'ChangeThisAdminPassword123!'; const exists=db.prepare('SELECT id FROM users WHERE email=?').get(email); if(!exists){const hash=await bcrypt.hash(password,12);db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run('GreenHost Admin',email,hash); console.log(`Initial admin created for ${email}. Change ADMIN_PASSWORD before deployment.`);}}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'GreenHost',paymentsConfigured:razorpayReady}));
app.get('/api/config',(req,res)=>res.json({razorpayKeyId:razorpayReady?process.env.RAZORPAY_KEY_ID:null,paymentsConfigured:razorpayReady,brand:'GreenHost'}));
app.get('/api/plans',(req,res)=>res.json({plans:db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY monthly_paise').all().map(publicPlan)}));

const signupSchema=z.object({name:z.string().trim().min(2).max(80),email:z.string().trim().email().max(200),password:z.string().min(10).max(128)});
app.post('/api/auth/signup', async (req,res)=>{const parsed=signupSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Enter a name, valid email and password of at least 10 characters.'});const {name,email,password}=parsed.data;try{const hash=await bcrypt.hash(password,12);const result=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'customer')").run(name,email.toLowerCase(),hash);const user=db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').get(result.lastInsertRowid);res.cookie('gh_session',signToken(user),{httpOnly:true,secure:isProd,sameSite:'lax',maxAge:7*24*60*60*1000,path:'/'});res.status(201).json({user});}catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'An account with that email already exists.'});console.error(e);res.status(500).json({error:'Could not create account.'});}});
app.post('/api/auth/login', async (req,res)=>{const email=String(req.body?.email||'').trim().toLowerCase();const password=String(req.body?.password||'');if(email.length>200||password.length>128)return res.status(400).json({error:'Invalid credentials.'});const userRow=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!userRow||!(await bcrypt.compare(password,userRow.password_hash)))return res.status(401).json({error:'Email or password is incorrect.'});const user={id:userRow.id,name:userRow.name,email:userRow.email,role:userRow.role,created_at:userRow.created_at};res.cookie('gh_session',signToken(user),{httpOnly:true,secure:isProd,sameSite:'lax',maxAge:7*24*60*60*1000,path:'/'});res.json({user});});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('gh_session',{httpOnly:true,secure:isProd,sameSite:'lax',path:'/'});res.json({ok:true});});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:req.user}));

app.post('/api/orders',auth,async(req,res)=>{const schema=z.object({planId:z.string().min(1),billingCycle:z.enum(['monthly','yearly'])});const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Choose a valid plan and billing cycle.'});const plan=db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(parsed.data.planId);if(!plan)return res.status(404).json({error:'Plan not found.'});const amount=parsed.data.billingCycle==='monthly'?plan.monthly_paise:plan.yearly_paise;if(amount<115000||amount>1000000)return res.status(400).json({error:'Plan price is outside the allowed range.'});if(!razorpayReady)return res.status(503).json({error:'Online payments are not configured yet. Add Razorpay test keys to .env to enable checkout.'});try{const local=db.prepare('INSERT INTO orders(user_id,plan_id,billing_cycle,amount_paise) VALUES(?,?,?,?)').run(req.user.id,plan.id,parsed.data.billingCycle,amount);const order=await razorpay.orders.create({amount,currency:'INR',receipt:`gh_${local.lastInsertRowid}`,notes:{greenhost_order_id:String(local.lastInsertRowid),user_id:String(req.user.id),plan_id:plan.id}});db.prepare('UPDATE orders SET razorpay_order_id=? WHERE id=?').run(order.id,local.lastInsertRowid);res.status(201).json({orderId:order.id,localOrderId:local.lastInsertRowid,amount,currency:'INR',keyId:process.env.RAZORPAY_KEY_ID,customer:{name:req.user.name,email:req.user.email}});}catch(e){console.error('Order creation failed:',e.message);res.status(502).json({error:'Could not start payment. Please try again.'});}});

app.post('/api/payments/verify',auth,(req,res)=>{const schema=z.object({razorpay_order_id:z.string(),razorpay_payment_id:z.string(),razorpay_signature:z.string()});const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Payment verification details are incomplete.'});const {razorpay_order_id,razorpay_payment_id,razorpay_signature}=parsed.data;const order=db.prepare('SELECT * FROM orders WHERE razorpay_order_id=? AND user_id=?').get(razorpay_order_id,req.user.id);if(!order)return res.status(404).json({error:'Order not found.'});const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET||'').update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');const a=Buffer.from(expected);const b=Buffer.from(razorpay_signature);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(400).json({error:'Payment signature is invalid.'});if(order.status!=='paid'&&order.status!=='active'){db.prepare("UPDATE orders SET status='paid',razorpay_payment_id=?,paid_at=CURRENT_TIMESTAMP WHERE id=?").run(razorpay_payment_id,order.id);db.prepare('INSERT OR IGNORE INTO payment_events(event_key,event_type,order_id) VALUES(?,?,?)').run(`verify_${razorpay_payment_id}`,'payment.verified',order.id);}res.json({ok:true,message:'Payment verified. Your order is awaiting hosting provisioning.'});});

// Configure this endpoint URL in the Razorpay dashboard. Raw-body signature validation is required.
app.post('/api/payments/webhook',(req,res)=>{const secret=process.env.RAZORPAY_WEBHOOK_SECRET;if(!secret)return res.status(503).send('Webhook secret is not configured.');const signature=req.get('x-razorpay-signature')||'';const expected=crypto.createHmac('sha256',secret).update(req.rawBody||Buffer.alloc(0)).digest('hex');const a=Buffer.from(expected),b=Buffer.from(signature);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(400).send('Invalid webhook signature.');const event=req.body?.event;const payment=req.body?.payload?.payment?.entity;const razorOrderId=payment?.order_id;if(event==='payment.captured'&&razorOrderId){const order=db.prepare('SELECT * FROM orders WHERE razorpay_order_id=?').get(razorOrderId);if(order){db.prepare("UPDATE orders SET status='paid',razorpay_payment_id=?,paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP) WHERE id=? AND status IN ('pending','failed')").run(payment.id,order.id);db.prepare('INSERT OR IGNORE INTO payment_events(event_key,event_type,order_id) VALUES(?,?,?)').run(`webhook_${payment.id}`,event,order.id);}}res.json({received:true});});

app.get('/api/orders',auth,(req,res)=>{const rows=db.prepare('SELECT o.*,p.name AS plan_name FROM orders o JOIN plans p ON p.id=o.plan_id WHERE o.user_id=? ORDER BY o.id DESC').all(req.user.id);res.json({orders:rows.map(publicOrder)});});
app.get('/api/admin/summary',auth,admin,(req,res)=>{const users=db.prepare('SELECT COUNT(*) AS n FROM users WHERE role="customer"').get().n;const orders=db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;const paid=db.prepare("SELECT COALESCE(SUM(amount_paise),0) AS n FROM orders WHERE status IN ('paid','provisioning','active')").get().n;const pending=db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending','paid')").get().n;res.json({users,orders,revenue:paid/100,pending});});
app.get('/api/admin/orders',auth,admin,(req,res)=>{const rows=db.prepare('SELECT o.*,p.name AS plan_name,u.name AS customer_name,u.email AS customer_email FROM orders o JOIN plans p ON p.id=o.plan_id JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 500').all();res.json({orders:rows.map(o=>({...publicOrder(o),customerName:o.customer_name,customerEmail:o.customer_email,providerReference:o.provider_reference}))});});
app.patch('/api/admin/orders/:id/status',auth,admin,(req,res)=>{const allowed=['paid','provisioning','active','suspended','failed','cancelled'];const status=String(req.body?.status||'');if(!allowed.includes(status))return res.status(400).json({error:'Invalid status.'});const result=db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,Number(req.params.id));if(!result.changes)return res.status(404).json({error:'Order not found.'});res.json({ok:true});});
app.get('/api/admin/users',auth,admin,(req,res)=>res.json({users:db.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY id DESC LIMIT 500').all()}));

app.get('*',(req,res)=>res.sendFile(require('path').join(__dirname,'..','public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Unexpected server error.'});});
ensureAdmin().then(()=>app.listen(PORT,()=>console.log(`GreenHost running at http://localhost:${PORT}`))).catch(e=>{console.error(e);process.exit(1)});
