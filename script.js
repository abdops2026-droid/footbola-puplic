// ============================================================
// CONFIG — Admin passwords updated to 1414 / 1414
// ============================================================
const ADMIN_C1 = '1414';
const ADMIN_C2 = '1414';
const DB_KEY = 'footbola_v4';

function xpForLevel(lvl){return Math.floor(100*Math.pow(lvl,1.4))}
function getLevelFromXP(xp){let lvl=1;while(lvl<100&&xp>=xpForLevel(lvl+1))lvl++;return lvl}
function getLevelTitle(lvl){if(lvl>=90)return'LEGEND';if(lvl>=70)return'ELITE';if(lvl>=50)return'VETERAN';if(lvl>=30)return'REGULAR';if(lvl>=15)return'ROOKIE';return'AMATEUR'}

// ============================================================
// SUPABASE CLOUD ADAPTER
// ============================================================
const supabaseUrl = 'https://jvkjjpqlmofprmugkbxs.supabase.co';
const supabaseKey = 'sb_publishable_Dhyyi9tDjzS6cjSeqAK-_g_xL1DctLB';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let cloudDB = { players: [], pending: [], tournaments: [], news: [] };

function getDB() { return cloudDB; }
function freshDB() { return { players: [], pending: [], tournaments: [], news: [] }; }

// THE FULLY REPAIRED CLOUD SYNC (Fixes New User Freezes)
async function saveDB(db) {
    cloudDB = db;
    localStorage.setItem(DB_KEY, JSON.stringify(db)); // Local Backup

    // 1. Bulk Sync Players (Includes Status for Archive/Ban) & Tournaments
    const playerUpdates = db.players.map(p => ({
        player_id: p.id, name: p.name, pin: p.pin, photo: p.photo,
        tier: p.tier, stars: p.stars, stats: p.stats, market_value: p.marketValue,
        previous_market_value: p.previousMarketValue ?? null,
        market_value_history: p.marketValueHistory ?? [],
        status: p.status || 'active',
        bio: p.bio || '', position: p.position || '', preferred_foot: p.preferredFoot || '',
        age: p.age ?? null, jersey_number: p.jerseyNumber ?? null, favorite_team: p.favoriteTeam || ''
    }));

    const tournamentUpdates = db.tournaments.map(t => ({
        id: t.id, name: t.name, format: t.format, type: t.type, status: t.status,
        participants: t.participants, standings: t.standings, matches: t.matches,
        phase: t.phase, schedule: t.schedule, bracket: t.bracket,
        groups: t.groups, auto_qualify: t.autoQualify || false, archived_at: t.archivedAt || null,
        category: t.category || 'official',
        banner: t.banner || '', logo: t.logo || '', theme_color: t.themeColor || '#f0b429'
    }));

    try {
        await Promise.all([
            supabaseClient.from('players').upsert(playerUpdates, { onConflict: 'player_id' }),
            supabaseClient.from('tournaments').upsert(tournamentUpdates)
        ]);

        // 3. Sync News properly
        if(db.news && db.news.length > 0) {
            const latestNews = db.news[0];
            await supabaseClient.from('news').upsert({
                text: latestNews.text, icon: latestNews.icon, ts: latestNews.ts
            }, { onConflict: 'ts' });
        }
        
        // 4. Sync Admin Codes to Cloud
        if(db.adminCodes) {
            await supabaseClient.from('admin_settings').upsert({
                key: 'codes', value: db.adminCodes
            });
        }
    } catch (error) {
        console.error("Cloud Sync Failed", error);
    }
}

// THE SURGICAL SAVES (No more bulldozers)
async function saveSingleTournament(t) {
    if(!t) return;
    await supabaseClient.from('tournaments').upsert({
        id: t.id, name: t.name, format: t.format, type: t.type, status: t.status,
        participants: t.participants, standings: t.standings, matches: t.matches,
        phase: t.phase, schedule: t.schedule, bracket: t.bracket,
        groups: t.groups, auto_qualify: t.autoQualify || false, archived_at: t.archivedAt || null,
        category: t.category || 'official',
        banner: t.banner || '', logo: t.logo || '', theme_color: t.themeColor || '#f0b429'
    });
}

async function saveSinglePlayer(p) {
    if(!p) return;
    await supabaseClient.from('players').upsert({
        player_id: p.id, name: p.name, pin: p.pin, photo: p.photo,
        tier: p.tier, stars: p.stars, stats: p.stats, market_value: p.marketValue,
        previous_market_value: p.previousMarketValue ?? null,
        market_value_history: p.marketValueHistory ?? [],
        status: p.status || 'active',
        bio: p.bio || '', position: p.position || '', preferred_foot: p.preferredFoot || '',
        age: p.age ?? null, jersey_number: p.jerseyNumber ?? null, favorite_team: p.favoriteTeam || ''
    }, { onConflict: 'player_id' });
}

// ============================================================
// STATE
// ============================================================
let currentUser=null;
let activeTournIdx=null;
let cData={format:'league',type:'1v1',category:'official',selected:[],teams:[]};
let arenaFilterStatus='all';
let lockerFilterTier='all';
let marketFilterTier='all';
let pendingPro=null;
let motmMatchIdx=null;
let motmVotes={motm:null,ratings:{}};

// ============================================================
// UTILS
// ============================================================
function genID(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return'FBL-'+Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join('')}
function initials(name){return name.split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'??'}
function avHTML(p,size=46){
  const s=`width:${size}px;height:${size}px;font-size:${Math.round(size*0.32)}px`;
  return `<div class="pav" style="${s}">${p.photo?`<img src="${p.photo}" loading="lazy">`:`${initials(p.name)}`}</div>`
}
// ============================================================
// HAPTICS — tiny helper, silently no-ops on devices/browsers
// that don't support the Vibration API.
// ============================================================
function haptic(pattern=15){
  try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch(e){}
}

// ============================================================
// RUNTIME TRANSITION STYLES — injected via JS so screen/tab
// switches can fade smoothly without touching style.css.
// ============================================================
(function injectTransitionStyles(){
  const style=document.createElement('style');
  style.textContent=`
    .screen.active{animation:fbFadeIn 0.28s ease}
    .tab-content.active{animation:fbFadeIn 0.22s ease}
    @keyframes fbFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    .skel{background:linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.09) 37%,rgba(255,255,255,0.04) 63%);background-size:400% 100%;animation:fbShimmer 1.4s ease infinite;border-radius:13px}
    @keyframes fbShimmer{0%{background-position:100% 50%}100%{background-position:0% 50%}}
    .theme-swatch{width:34px;height:34px;border-radius:50%;cursor:pointer;border:3px solid transparent;transition:all 0.15s;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.15)}
    .theme-swatch.sel{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,0.25),0 0 12px rgba(255,255,255,0.4)}
  `;
  document.head.appendChild(style);
})();

function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id)?.classList.add('active')}

// ============================================================
// NEW AVATAR HELPER FOR TOURNAMENTS
// ============================================================
function getMiniAv(id, t, db) {
  if(!id) return `<div style="width:22px;height:22px;border-radius:50%;background:var(--card2);border:1px dashed var(--border);flex-shrink:0"></div>`;
  const s = t.standings.find(x => x.id === id);
  if(!s) return '';

  if(t.type === '1v1') {
    const p = db.players.find(x => x.id === id);
    if(p && p.photo) return `<img src="${p.photo}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1px solid var(--border);flex-shrink:0">`;
    return `<div style="width:22px;height:22px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--gold);border:1px solid var(--border);flex-shrink:0">${initials(s.name)}</div>`;
  } else {
    // 2v2 Logic: Overlapping Photos
    const p1 = db.players.find(x => x.id === s.proId);
    const p2 = db.players.find(x => x.id === s.youthId);
    const i1 = (p1 && p1.photo) ? `<img src="${p1.photo}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1px solid var(--card);flex-shrink:0;position:relative;z-index:2">` : `<div style="width:22px;height:22px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--gold);border:1px solid var(--card);flex-shrink:0;position:relative;z-index:2">${initials(s.proName||'?')}</div>`;
    const i2 = (p2 && p2.photo) ? `<img src="${p2.photo}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1px solid var(--card);flex-shrink:0;margin-left:-10px;position:relative;z-index:1">` : `<div style="width:22px;height:22px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--gold);border:1px solid var(--card);flex-shrink:0;margin-left:-10px;position:relative;z-index:1">${initials(s.youthName||'?')}</div>`;
    return `<div style="display:flex;align-items:center">${i1}${i2}</div>`;
  }
}
function showTab(tab){
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');
  haptic(8);
  renderTab(tab);
}
function showErr(id,msg){haptic(25);const el=document.getElementById(id);if(el){el.textContent=msg;el.classList.add('show')}}
function hideErr(id){document.getElementById(id)?.classList.remove('show')}
function snack(msg){const el=document.getElementById('snack');el.textContent=msg;el.classList.add('show');clearTimeout(snack._t);snack._t=setTimeout(()=>el.classList.remove('show'),2800)}

// ============================================================
// PERFORMANCE: skip re-writing the DOM when the HTML we're about
// to render is identical to what's already there — avoids needless
// reflow/repaint on every tab switch or timer tick.
// ============================================================
const _renderCache=new WeakMap();
function setHTMLIfChanged(el,html){
  if(!el)return;
  if(_renderCache.get(el)===html)return;
  _renderCache.set(el,html);
  el.innerHTML=html;
}
function closeModal(id){document.getElementById(id)?.classList.remove('active')}
function closeConf(){document.getElementById('conf-ov')?.classList.remove('active')}

// ============================================================
// THE SAFE NEWS SYSTEM (WITH TELEGRAM)
// ============================================================
async function addNews(text, icon='📰'){
  const db=getDB();
  db.news=db.news||[];
  const newItem = {text, icon, ts:Date.now()};
  db.news.unshift(newItem);
  
  try {
      await supabaseClient.from('news').insert([newItem]);
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      
      // نرسل الأيقونة مع النص للبوت ليعرف كيف يتفاعل
      sendTelegramAlert(`${icon} ${text}`);
      
  } catch(e) { console.error("News sync error", e); }
}

function timeAgo(ts){
  const diff=Date.now()-ts;
  const m=Math.floor(diff/60000);
  if(m<1)return'Just now';
  if(m<60)return`${m}m ago`;
  const h=Math.floor(m/60);
  if(h<24)return`${h}h ago`;
  return`${Math.floor(h/24)}d ago`;
}

// ============================================================
// PHOTO UPLOAD
// ============================================================
function handlePhoto(input,prevId,dataId){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const canvas=document.createElement('canvas');
      const size=240;canvas.width=canvas.height=size;
      const ctx=canvas.getContext('2d');
      const min=Math.min(img.width,img.height);
      ctx.drawImage(img,(img.width-min)/2,(img.height-min)/2,min,min,0,0,size,size);
      const data=canvas.toDataURL('image/jpeg',0.72);
      document.getElementById(prevId).innerHTML=`<img src="${data}">`;
      document.getElementById(dataId).value=data;
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

// ============================================================
// AUTH
// ============================================================
function gateToggle(which){
  ['player','new','admin'].forEach(g=>{
    const el=document.getElementById('gate-'+g);
    if(g===which)el.classList.toggle('expanded');
    else el.classList.remove('expanded');
  });
}
function playerLogin(){
  const id=document.getElementById('login-id').value.trim();
  const pin=document.getElementById('login-pin').value.trim();
  hideErr('login-error');
  const db=getDB();
  const p=db.players.find(p=>p.id.toLowerCase()===id.toLowerCase() && p.pin===pin);
  if(!p){showErr('login-error','Invalid Username or PIN.');return}
  if(p.status === 'banned') {showErr('login-error', '🚫 Your account has been removed.');return;}
  // 🔒 Block suspended players
  if(p.status === 'suspended') {showErr('login-error', '🟥 You are currently suspended!');return;}
  currentUser={type:'player',id:p.id,name:p.name};
  localStorage.setItem('footbola_session', JSON.stringify(currentUser));
  enterApp();
}
// ============================================================
// NEW ACCOUNT (DIRECT ASYNC UPLOAD)
// ============================================================
async function newAccount(){
  const btn = document.querySelector('#gate-new .btn-green');
  const originalText = btn.innerHTML;
  
  const name=document.getElementById('new-name').value.trim();
  const username=document.getElementById('new-username').value.trim();
  const pin=document.getElementById('new-pin').value.trim();
  const photo=document.getElementById('new-photo-data').value;
  hideErr('new-error');
  
  if(!name){showErr('new-error','Please enter your name.');return}

  const userRegex = /^[a-zA-Z\u0621-\u064A]+[0-9]{4}[^a-zA-Z0-9\u0621-\u064A\s]$/;
  if(!userRegex.test(username)) {
      showErr('new-error', 'Username MUST be: Name + 4 Numbers + 1 Symbol (e.g. Kasr2026!)');
      return;
  }
  if(!/^\d{4}$/.test(pin)){showErr('new-error','PIN must be exactly 4 digits.');return}
  
  const db=getDB();
  if(db.players.find(p=>p.id.toLowerCase()===username.toLowerCase())){showErr('new-error','This Username is already taken!');return}
  if(db.pending.find(p=>p.username?.toLowerCase()===username.toLowerCase())){showErr('new-error','This Username is waiting for approval.');return}
  
  const reqData = { name:name, username:username, pin:pin, photo:photo||'', ts:Date.now() };
  
  try {
      btn.innerHTML = '⏳ جاري الإرسال...';
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.7';

      const { error } = await supabaseClient.from('pending_requests').insert([reqData]);
      if(error) throw error;
      
      db.pending.push(reqData);

      snack('✅ تم الارسال.. يرجي الانتظار للموافقة');
      
      gateToggle(''); 
      showScreen('screen-auth'); 
      
      ['new-name','new-username','new-pin','new-photo-data'].forEach(id => {
          const el = document.getElementById(id);
          if(el) el.value = '';
      });
      document.getElementById('new-photo-prev').innerHTML = '📷';

  } catch (err) {
      console.error(err);
      showErr('new-error','Network Error. Could not send request.');
  } finally {
      btn.innerHTML = originalText;
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '1';
  }
}

function adminLogin(){
  const c1=document.getElementById('admin-c1').value.trim();
  const c2=document.getElementById('admin-c2').value.trim();
  hideErr('admin-error');
  const db=getDB();
  const validC1=db.adminCodes?.c1||ADMIN_C1;
  const validC2=db.adminCodes?.c2||ADMIN_C2;
  if(c1!==validC1||c2!==validC2){showErr('admin-error','Invalid secret codes. Access denied.');return}
  currentUser={type:'admin',id:'ADMIN',name:'Manager'};
  localStorage.setItem('footbola_session', JSON.stringify(currentUser));
  enterApp();
}

function enterApp(){
    showScreen('screen-app');
    renderUserBadge();
    showTab('arena');
    initPullToRefresh();
    // START MUSIC — wait for the (now dynamic) playlist to finish loading
    // from Supabase before trying to play anything.
    loadPlaylist().then(list=>{ if(list.length && (!bgMusic || bgMusic.paused)) toggleMusic(); });
}

// ============================================================
// PULL TO REFRESH — drag down from the top of any tab to sync.
// Built at runtime (no index.html/style.css changes needed).
// ============================================================
function initPullToRefresh(){
  const screen=document.getElementById('screen-app');
  if(!screen||screen._ptrInit)return;
  screen._ptrInit=true;
  // Note: #screen-app already has position:absolute via style.css, which
  // already establishes a containing block for our absolutely-positioned
  // indicator below — no need to (and must not) override it here.

  const indicator=document.createElement('div');
  indicator.id='pull-refresh-indicator';
  indicator.textContent='🔄';
  indicator.style.cssText='position:absolute;top:0;left:50%;transform:translate(-50%,-40px);z-index:60;font-size:20px;pointer-events:none;opacity:0;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4))';
  screen.prepend(indicator);

  let startY=0,pulling=false,triggered=false;
  const activeScrollTop=()=>document.querySelector('.tab-content.active')?.scrollTop||0;

  screen.addEventListener('touchstart',e=>{
    if(activeScrollTop()>0)return;
    startY=e.touches[0].clientY;
    pulling=true;triggered=false;
  },{passive:true});

  screen.addEventListener('touchmove',e=>{
    if(!pulling)return;
    const dy=e.touches[0].clientY-startY;
    if(dy>0&&activeScrollTop()<=0){
      const pull=Math.min(dy*0.5,80);
      indicator.style.transform=`translate(-50%, ${pull-40}px) rotate(${pull*4}deg)`;
      indicator.style.opacity=String(Math.min(pull/55,1));
      if(pull>55&&!triggered){triggered=true;haptic(15);}
    }
  },{passive:true});

  screen.addEventListener('touchend',()=>{
    if(!pulling)return;
    pulling=false;
    if(triggered){
      indicator.style.transition='transform 0.3s ease';
      indicator.style.transform='translate(-50%, 14px) rotate(0deg)';
      refreshData();
    }
    setTimeout(()=>{
      indicator.style.transition='transform 0.25s ease, opacity 0.25s ease';
      indicator.style.transform='translate(-50%,-40px)';
      indicator.style.opacity='0';
      setTimeout(()=>{indicator.style.transition='';},260);
    },triggered?500:0);
  },{passive:true});
}
function logout(){
  currentUser=null;
  localStorage.removeItem('footbola_session');
  showScreen('screen-auth');
  ['login-id','login-pin','new-name','new-pin','new-photo-data','admin-c1','admin-c2'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});
  document.getElementById('new-photo-prev').innerHTML='📷';
  ['login-error','new-error','admin-error'].forEach(hideErr);
  document.querySelectorAll('.gate').forEach(g=>g.classList.remove('expanded'));
}

// ============================================================
// USER BADGE
// ============================================================
function renderUserBadge(){
  const el=document.getElementById('user-badge');if(!el||!currentUser)return;
  if(currentUser.type==='admin'){
    el.innerHTML='<span>🛡️</span><span style="font-size:13px">Manager</span>';
  } else {
    const db=getDB();const p=db.players.find(x=>x.id===currentUser.id);
    const xp=p?.stats?.xp||0;const lvl=getLevelFromXP(xp);
    const avEl=p?.photo?`<div class="uav"><img src="${p.photo}" loading="lazy"></div>`:`<div class="uav">${initials(currentUser.name)}</div>`;
    el.innerHTML=`${avEl}<span style="font-size:13px">${currentUser.name}</span><span class="lvl-badge">LVL ${lvl}</span>`;
  }
}

// ============================================================
// SELF PROFILE / EDIT
// ============================================================
function openSelfProfile(){
  if(currentUser?.type==='admin'){openAdminSettings();return}
  const db=getDB();
  const pIdx=db.players.findIndex(x=>x.id===currentUser?.id);
  if(pIdx>=0)openProfile(pIdx,true);
}

function openAdminSettings(){
  const body=document.getElementById('edit-profile-body');
  body.innerHTML=`
    <div class="settings-card">
      <div class="settings-title">🔑 Change Admin Codes</div>
      <div class="field"><label>New Code 1</label><input id="admin-new-c1" type="password" placeholder="New first code"></div>
      <div class="field"><label>New Code 2</label><input id="admin-new-c2" type="password" placeholder="New second code"></div>
      <button class="btn btn-red" onclick="changeAdminCodes()" style="margin-top:4px">CHANGE CODES</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">🛡️ Reset Any Player PIN</div>
      <select class="select-field" id="admin-reset-player-sel" style="margin-bottom:12px">
        <option value="">— Select Player —</option>
        ${getDB().players.map(p=>`<option value="${p.id}">${p.name} (${p.id})</option>`).join('')}
      </select>
      <div class="field"><label>New PIN</label><input id="admin-reset-new-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <button class="btn btn-gold" onclick="adminResetPin()">RESET PIN</button>
    </div>`;
  document.getElementById('modal-edit-profile').classList.add('active');
}

// ============================================================
// SECURE ADMIN CODES UPDATE
// ============================================================
async function changeAdminCodes(){
  const c1=document.getElementById('admin-new-c1').value.trim();
  const c2=document.getElementById('admin-new-c2').value.trim();
  if(!c1||!c2){snack('⚠️ Enter both codes');return}
  const db=getDB();
  db.adminCodes={c1,c2};
  
  // رفع الأكواد السرية فقط للسيرفر
  try {
      await supabaseClient.from('admin_settings').upsert({ key: 'codes', value: db.adminCodes });
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      snack('✅ Admin codes updated');
      closeModal('modal-edit-profile');
  } catch(e) {
      snack('❌ Failed to update codes');
  }
}

async function adminResetPin(){
  const pid=document.getElementById('admin-reset-player-sel').value;
  const pin=document.getElementById('admin-reset-new-pin').value.trim();
  if(!pid){snack('⚠️ Select a player');return}
  if(!/^\d{4}$/.test(pin)){snack('⚠️ PIN must be 4 digits');return}
  const db=getDB();
  const p=db.players.find(x=>x.id===pid);
  if(p){
      p.pin=pin;
      // الحفظ الذكي
      await saveSinglePlayer(p); 
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      snack(`✅ PIN reset for ${p.name}`);
  }
  closeModal('modal-edit-profile');
}

// ============================================================
// TAB ROUTING
// ============================================================
// ============================================================
// MANAGER DASHBOARD (ADMIN ONLY)
// ============================================================
function renderDashboard(){
  const db=getDB();
  const container=document.getElementById('tab-dashboard');
  if(!container)return;
  if(currentUser?.type!=='admin'){
    container.innerHTML=`<div class="empty-state"><div class="empty-ico">🔒</div><div class="empty-txt">Admin access only.</div></div>`;
    return;
  }
  const players=db.players||[];
  const activeP=players.filter(p=>!p.status||p.status==='active').length;
  const suspendedP=players.filter(p=>p.status==='suspended').length;
  const bannedP=players.filter(p=>p.status==='banned').length;
  const archivedP=players.filter(p=>p.status==='archived').length;

  const tournaments=db.tournaments||[];
  const liveT=tournaments.filter(t=>t.status==='active'&&!t.archivedAt).length;
  const endedT=tournaments.filter(t=>t.status==='ended'&&!t.archivedAt).length;
  const archivedT=tournaments.filter(t=>t.archivedAt).length;

  const topScorer=[...players].sort((a,b)=>(b.stats?.goals||0)-(a.stats?.goals||0))[0];
  const mostTrophies=[...players].sort((a,b)=>(b.stats?.trophies||0)-(a.stats?.trophies||0))[0];
  const mostValuable=[...players].sort((a,b)=>(b.marketValue||0)-(a.marketValue||0))[0];
  const totalValue=players.reduce((sum,p)=>sum+(p.marketValue||500000),0);
  const totalValueStr=totalValue>=1000000?`€${(totalValue/1000000).toFixed(2)}M`:`€${(totalValue/1000).toFixed(0)}K`;

  const allMatches=[];
  tournaments.forEach(t=>{(t.matches||[]).forEach(m=>{allMatches.push({...m,tournamentName:t.name});});});
  allMatches.sort((a,b)=>(b.ts||0)-(a.ts||0));
  const recent=allMatches.slice(0,8);

  const statCard=(icon,val,lbl,color)=>`<div class="stat-cell" style="padding:12px 4px${color?`;border-color:${color}`:''}"><div class="stat-val" style="font-size:22px${color?`;color:${color}`:''}">${icon} ${val}</div><div class="stat-lbl">${lbl}</div></div>`;

  container.innerHTML=`
    <div class="sec-hdr"><div class="sec-ttl">📊 Manager Dashboard</div></div>
    <div style="padding:0 14px 14px">
      <div class="settings-card">
        <div class="settings-title" style="font-size:11px">👥 Players (${players.length} total)</div>
        <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);gap:6px">
          ${statCard('🟢',activeP,'Active','var(--green)')}
          ${statCard('🟥',suspendedP,'Suspended','var(--red)')}
          ${statCard('🚫',bannedP,'Banned','var(--red)')}
          ${statCard('📦',archivedP,'Archived')}
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-title" style="font-size:11px">🏟️ Tournaments (${tournaments.length} total)</div>
        <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);gap:6px">
          ${statCard('🔴',liveT,'Live','var(--green)')}
          ${statCard('🏁',endedT,'Ended')}
          ${statCard('📦',archivedT,'Archived')}
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-title" style="font-size:11px">🌟 Leaders</div>
        <div style="font-size:13px;line-height:2">
          <div>⚽ Top Scorer: <strong style="color:var(--gold)">${topScorer?.name||'—'}</strong> (${topScorer?.stats?.goals||0} goals)</div>
          <div>🏆 Most Decorated: <strong style="color:var(--gold)">${mostTrophies?.name||'—'}</strong> (${mostTrophies?.stats?.trophies||0} trophies)</div>
          <div>💰 Most Valuable: <strong style="color:var(--gold)">${mostValuable?.name||'—'}</strong> (€${(((mostValuable?.marketValue)||500000)/1000000).toFixed(2)}M)</div>
          <div>📊 Total Squad Value: <strong style="color:var(--gold)">${totalValueStr}</strong></div>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-title" style="font-size:11px">🕒 Recent Activity</div>
        ${recent.length===0?`<div style="font-size:12px;color:var(--sub)">No matches recorded yet.</div>`:recent.map(m=>`
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)">
            <span>${m.teamA} <strong>${m.goalsA}-${m.goalsB}</strong> ${m.teamB}</span>
            <span style="color:var(--sub)">${m.tournamentName}</span>
          </div>`).join('')}
      </div>
      <div class="settings-card">
        <div class="settings-title" style="font-size:11px">💾 Backup & Restore</div>
        <div style="font-size:11px;color:var(--sub);margin-bottom:8px">Export a full backup of every player, tournament, and news item, or restore from a previous backup file.</div>
        <button class="btn btn-blue" style="margin-bottom:8px" onclick="exportBackup()">⬇️ Export Backup (.json)</button>
        <input type="file" id="restore-file-input" accept=".json" style="display:none" onchange="handleRestoreFile(this)">
        <button class="btn btn-gold" onclick="document.getElementById('restore-file-input').click()">⬆️ Restore From Backup</button>
      </div>
    </div>`;
}

function exportBackup(){
  const db=getDB();
  const backup={
    exportedAt:new Date().toISOString(),
    version:1,
    players:db.players||[],
    tournaments:db.tournaments||[],
    news:db.news||[],
    adminCodes:db.adminCodes||null
  };
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const dateStr=new Date().toISOString().slice(0,10);
  a.href=url;a.download=`footbola-backup-${dateStr}.json`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  snack('⬇️ Backup downloaded.');
}

function handleRestoreFile(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async(e)=>{
    let data;
    try{data=JSON.parse(e.target.result);}
    catch(err){snack('❌ Invalid backup file — not valid JSON.');input.value='';return;}
    if(!Array.isArray(data.players)||!Array.isArray(data.tournaments)){
      snack("❌ This file doesn't look like a Footbola backup.");input.value='';return;
    }
    const confirmText=prompt(`⚠️ DANGER: This will REPLACE ALL current players (${data.players.length} in backup) and tournaments (${data.tournaments.length} in backup) with this backup from ${data.exportedAt||'an unknown date'}.\n\nEverything currently in the app that isn't in this backup will be permanently lost.\n\nType "RESTORE" to confirm.`);
    if(confirmText!=='RESTORE'){snack('❌ Restore canceled.');input.value='';return;}
    await restoreBackup(data);
    input.value='';
  };
  reader.readAsText(file);
}

async function restoreBackup(data){
  const db=getDB();
  try{
    // Wipe the cloud tables first so this is a true replace, not a merge with old rows
    await supabaseClient.from('players').delete().neq('player_id','__never__');
    await supabaseClient.from('tournaments').delete().neq('id',-1);

    db.players=data.players||[];
    db.tournaments=data.tournaments||[];
    db.news=data.news||[];
    if(data.adminCodes)db.adminCodes=data.adminCodes;

    await saveDB(db);
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    snack('✅ Backup restored successfully!');
    renderDashboard();
    renderArena();
  }catch(err){
    console.error(err);
    snack('❌ Restore failed — check your connection and try again.');
  }
}

function renderTab(tab){
  if(tab==='arena')renderArena();
  else if(tab==='locker')renderLocker();
  else if(tab==='history')renderHistory();
  else if(tab==='market')renderMarket();
  else if(tab==='dashboard')renderDashboard();
}

// ============================================================
// NEWS FEED
// ============================================================
// ============================================================
// LIVE BREAKING NEWS RENDERER
// ============================================================
function renderNewsFeed(){
  const db=getDB();
  const feed=document.getElementById('news-feed');if(!feed)return;
  const items=db.news||[];
  
  if(items.length===0){
    feed.innerHTML='<div style="font-size:13px;color:var(--sub);padding:14px 0;text-align:center;background:var(--card);border-radius:12px">No news yet — play some matches!</div>';
    return;
  }
  
  feed.innerHTML=items.slice(0,10).map((n, i)=>{
    const isLatest = (i === 0) ? 'latest' : '';
    const timeDisplay = (i === 0) ? '🔴 LIVE NOW' : timeAgo(n.ts);
    
    return `
    <div class="news-item ${isLatest}">
      <div class="news-ico">${n.icon||'📰'}</div>
      <div class="news-body">
        <div class="news-txt">${n.text}</div>
        <div class="news-time">${timeDisplay}</div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// ARENA
// ============================================================
function setArenaFilter(el){
  el.parentElement.querySelectorAll('.f-opt').forEach(x=>x.classList.remove('sel'));
  el.classList.add('sel');
  arenaFilterStatus=el.dataset.val;
  renderArena();
}
function setLockerFilter(el){
  el.parentElement.querySelectorAll('.f-opt').forEach(x=>x.classList.remove('sel'));
  el.classList.add('sel');
  lockerFilterTier=el.dataset.val;
  renderLocker();
}
function setMarketFilter(el){
  el.parentElement.querySelectorAll('.f-opt').forEach(x=>x.classList.remove('sel'));
  el.classList.add('sel');
  marketFilterTier=el.dataset.val;
  renderMarket();
}

// ============================================================
// ADVANCED SEARCH — level / market value / goals range filters,
// shared between the Locker and Market screens.
// ============================================================
function toggleAdvFilters(scope){
  const panel=document.getElementById(scope+'-adv-panel');
  const btn=document.getElementById(scope+'-adv-toggle');
  if(!panel||!btn)return;
  const show=panel.style.display==='none';
  panel.style.display=show?'block':'none';
  btn.style.color=show?'var(--gold)':'var(--sub)';
  btn.style.borderColor=show?'var(--gold)':'var(--border)';
}
function clearAdvFilters(scope){
  ['lvl-min','lvl-max','val-min','val-max','goals-min','goals-max'].forEach(suf=>{
    const el=document.getElementById(scope+'-'+suf);
    if(el)el.value='';
  });
  if(scope==='locker')renderLocker();else renderMarket();
}
function getAdvRange(scope){
  const num=id=>{const v=parseFloat(document.getElementById(id)?.value);return isNaN(v)?null:v;};
  return{
    lvlMin:num(scope+'-lvl-min'),lvlMax:num(scope+'-lvl-max'),
    valMin:num(scope+'-val-min'),valMax:num(scope+'-val-max'),
    goalsMin:num(scope+'-goals-min'),goalsMax:num(scope+'-goals-max')
  };
}
function passesAdvFilter(p,range){
  const lvl=getLevelFromXP(p.stats?.xp||0);
  const valM=(p.marketValue||500000)/1000000;
  const goals=p.stats?.goals||0;
  if(range.lvlMin!=null&&lvl<range.lvlMin)return false;
  if(range.lvlMax!=null&&lvl>range.lvlMax)return false;
  if(range.valMin!=null&&valM<range.valMin)return false;
  if(range.valMax!=null&&valM>range.valMax)return false;
  if(range.goalsMin!=null&&goals<range.goalsMin)return false;
  if(range.goalsMax!=null&&goals>range.goalsMax)return false;
  return true;
}

function renderArena(){
  const db=getDB();
  const isAdmin=currentUser?.type==='admin';
  const createBtn=document.getElementById('create-btn');
  if(createBtn)createBtn.style.display=isAdmin?'flex':'none';
  const challengeBtn=document.getElementById('challenge-btn');
  if(challengeBtn)challengeBtn.style.display=isAdmin?'flex':'none';
  const navDash=document.getElementById('nav-dashboard');
  if(navDash)navDash.style.display=isAdmin?'':'none';
  const archChip=document.getElementById('arena-filter-archived');
  if(archChip)archChip.style.display=isAdmin?'':'none';
  renderNewsFeed();
  const list=document.getElementById('tournament-list');
  const searchTerm=(document.getElementById('arena-search')?.value||'').trim().toLowerCase();
  let items=db.tournaments.map((t,i)=>({t,i})).filter(x=>isAdmin||!x.t.archivedAt);
  if(searchTerm)items=items.filter(({t})=>t.name.toLowerCase().includes(searchTerm));
  if(arenaFilterStatus==='active')items=items.filter(({t})=>t.status==='active'&&!t.archivedAt);
  else if(arenaFilterStatus==='ended')items=items.filter(({t})=>t.status==='ended'&&!t.archivedAt);
  else if(arenaFilterStatus==='archived')items=items.filter(({t})=>!!t.archivedAt);
  if(items.length===0){
    list.innerHTML=`<div class="empty-state"><div class="empty-ico">🏟️</div><div class="empty-txt">${searchTerm||arenaFilterStatus!=='all'?'No tournaments match your search/filter.':`No tournaments yet.<br>${isAdmin?'Tap CREATE to start!':'Ask the Manager.'}`}</div></div>`;
    return;
  }
  setHTMLIfChanged(list, items.map(({t,i})=>{
    const badge=t.archivedAt
      ?`<span class="ended-badge">📦 ARCHIVED</span>`
      :t.status==='ended'
      ?`<span class="ended-badge">ENDED</span>`
      :`<div class="live-badge"><div class="live-dot"></div>LIVE</div>`;
    const catTag=t.category==='friendly'
      ?`<span style="font-size:9px;font-weight:700;background:rgba(240,180,41,0.12);color:var(--gold);padding:2px 8px;border-radius:20px;border:1px solid rgba(240,180,41,0.25);margin-left:6px">🤝 FRIENDLY</span>`
      :t.category==='qualifier'
      ?`<span style="font-size:9px;font-weight:700;background:rgba(77,171,247,0.12);color:var(--blue);padding:2px 8px;border-radius:20px;border:1px solid rgba(77,171,247,0.25);margin-left:6px">🎯 QUALIFIER</span>`
      :'';
    const bannerHtml=t.banner?`<div style="margin:-18px -18px 12px;height:68px;background-image:url('${t.banner}');background-size:cover;background-position:center;border-radius:16px 16px 0 0"></div>`:'';
    const logoHtml=t.logo?`<img src="${t.logo}" style="width:22px;height:22px;border-radius:6px;object-fit:cover;margin-right:6px;flex-shrink:0;vertical-align:middle">`:'';
    const cardStyleAttr=t.themeColor?` style="--gold:${t.themeColor}"`:'';
    return `<div class="t-card" onclick="openTournament(${i})"${cardStyleAttr}>
      ${bannerHtml}
      <div class="t-card-top"><div style="display:flex;align-items:center">${badge}${catTag}</div><div class="av-stack">${buildAvatarStack(t,db)}</div></div>
      <div class="t-name" style="display:flex;align-items:center">${logoHtml}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.name}</span></div>
      <div class="t-meta">${t.type.toUpperCase()} · ${t.format==='league'?'🏅 League':'🌳 Elimination'} · ${t.participants.length} ${t.type==='2v2'?'teams':'players'}</div>
    </div>`;
  }).join(''));
}

function buildAvatarStack(t,db){
  const MAX=4;
  return t.participants.slice(0,MAX).map(p=>{
    if(t.type==='2v2')return`<div class="av-circle">${(p.proName||p.name||'?').slice(0,2).toUpperCase()}</div>`;
    const player=db.players.find(x=>x.id===p);
    if(!player)return`<div class="av-circle">?</div>`;
    return player.photo?`<div class="av-circle"><img src="${player.photo}"></div>`:`<div class="av-circle">${initials(player.name)}</div>`;
  }).join('')+(t.participants.length>MAX?`<div class="av-circle">+${t.participants.length-MAX}</div>`:'');
}

// ============================================================
// CREATE TOURNAMENT
// ============================================================
function openCreate(){
  cData={format:'league',type:'1v1',category:'official',selected:[],teams:[],groupCount:2,groupAssign:null,groupQualifiers:[],legs:2,autoQualify:false,themeColor:'#f0b429'};pendingPro=null;
  document.getElementById('cup-name').value='';
  document.querySelectorAll('#category-row .f-opt').forEach(el=>el.classList.toggle('sel',el.dataset.val==='official'));
  document.querySelectorAll('#format-row .f-opt').forEach(el=>el.classList.toggle('sel',el.dataset.val==='league'));
  document.querySelectorAll('#type-row .f-opt').forEach(el=>el.classList.toggle('sel',el.dataset.val==='1v1'));
  document.querySelectorAll('#theme-color-row .theme-swatch').forEach(el=>el.classList.toggle('sel',el.dataset.color==='#f0b429'));
  const bannerPrev=document.getElementById('create-banner-prev');if(bannerPrev)bannerPrev.innerHTML='🖼️';
  const bannerData=document.getElementById('create-banner-data');if(bannerData)bannerData.value='';
  const logoPrev=document.getElementById('create-logo-prev');if(logoPrev)logoPrev.innerHTML='🏷️';
  const logoData=document.getElementById('create-logo-data');if(logoData)logoData.value='';
  hideErr('create-err');
  renderCreatePlayers();
  renderGroupConfig();
  document.getElementById('modal-create').classList.add('active');
}
function setThemeColor(color,el){
  el.parentElement.querySelectorAll('.theme-swatch').forEach(x=>x.classList.remove('sel'));
  el.classList.add('sel');
  cData.themeColor=color;
}
function handleBannerPhoto(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const W=600,H=200;
      const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
      const ctx=canvas.getContext('2d');
      const scale=Math.max(W/img.width,H/img.height);
      const sw=W/scale,sh=H/scale;
      const sx=(img.width-sw)/2,sy=(img.height-sh)/2;
      ctx.drawImage(img,sx,sy,sw,sh,0,0,W,H);
      const data=canvas.toDataURL('image/jpeg',0.75);
      document.getElementById('create-banner-prev').innerHTML=`<img src="${data}" style="width:100%;height:100%;object-fit:cover">`;
      document.getElementById('create-banner-data').value=data;
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
function setCreate(prop,el){
  el.parentElement.querySelectorAll('.f-opt').forEach(x=>x.classList.remove('sel'));
  el.classList.add('sel');cData[prop]=el.dataset.val;
  if(prop==='category')return; // category doesn't affect player/format selections — nothing else to reset
  cData.selected=[];cData.teams=[];pendingPro=null;
  cData.groupAssign=null;cData.groupQualifiers=[];
  renderCreatePlayers();
  renderGroupConfig();
}

// ============================================================
// GROUP STAGE CONFIGURATION (Create Modal)
// ============================================================
function participantCountForCreate(){
  return cData.type==='1v1'?cData.selected.length:cData.teams.length;
}
function renderGroupConfig(){
  const hint=document.getElementById('format-hint');
  const sec=document.getElementById('group-config-section');
  if(cData.format!=='groups'){
    sec.innerHTML='';
    hint.textContent=cData.format==='tree'?'🌳 Direct knockout bracket.':cData.format==='league'?'🏅 Everyone plays everyone (single flat table).':'';
    return;
  }
  hint.textContent='🧩 Split players into separate groups. Top players from each group advance to the knockout tree.';
  const total=participantCountForCreate();
  let html=`<div class="field"><label>Number of Groups</label>
    <input type="number" id="group-count-input" class="select-field" min="2" max="8" value="${cData.groupCount}" onchange="setGroupCount(this.value)">
    <div style="font-size:11px;color:var(--sub);margin-top:4px">Players are split evenly across this many groups. Each group plays its own mini-league.</div>
    </div>
    <div class="field"><label>Matches per Pairing</label>
      <div class="format-row">
        <div class="f-opt ${cData.legs===1?'sel':''}" onclick="setLegs(1,this)">Single Match</div>
        <div class="f-opt ${cData.legs===2?'sel':''}" onclick="setLegs(2,this)">Home &amp; Away (x2)</div>
      </div>
      <div style="font-size:11px;color:var(--sub);margin-top:4px">Home &amp; Away means every pair inside a group plays each other twice.</div>
    </div>
    <button class="btn btn-ghost" style="margin-bottom:10px" onclick="autoDistributeGroups()">🔀 Re-shuffle Randomly</button>
    <div style="font-size:11px;color:var(--sub);margin:-4px 0 10px">Groups fill in automatically below — tap any group letter next to a player to move them into that exact group, building any mix of group sizes you want.</div>
    <div id="group-boxes"></div>
    <label style="font-size:12px;display:flex;align-items:center;gap:6px;margin:10px 0;color:var(--sub)">
      <input type="checkbox" id="auto-qualify-chk" ${cData.autoQualify?'checked':''} onchange="cData.autoQualify=this.checked">
      Auto-generate the knockout tree once all group matches are played
    </label>`;
  if(total<4){
    html=`<div style="font-size:12px;color:var(--sub);padding:6px 0">Select at least 4 players/teams above to configure groups.</div>`+html;
  }
  sec.innerHTML=html;
  if(total>=4){
    if(!cData.groupAssign)autoDistributeGroups(true);
    else renderGroupBoxes();
  }
}
function setLegs(n,el){
  cData.legs=n;
  el.parentElement.querySelectorAll('.f-opt').forEach(x=>x.classList.remove('sel'));
  el.classList.add('sel');
}
function setGroupCount(val){
  const n=parseInt(val)||2;
  cData.groupCount=Math.max(2,Math.min(8,n));
  cData.groupAssign=null;cData.groupQualifiers=[];
  document.getElementById('group-boxes').innerHTML='';
  if(participantCountForCreate()>=4)autoDistributeGroups(true);
}
function autoDistributeGroups(silent){
  const total=participantCountForCreate();
  if(total<4){if(!silent)snack('⚠️ Select at least 4 players/teams first!');return}
  if(cData.groupCount>=total){if(!silent)snack('⚠️ Too many groups for this number of players!');return}
  const indices=[...Array(total).keys()].sort(()=>Math.random()-0.5);
  const groups=Array.from({length:cData.groupCount},()=>[]);
  indices.forEach((idx,i)=>groups[i%cData.groupCount].push(idx));
  if(groups.some(g=>g.length<2)){if(!silent)snack('⚠️ Too many groups — some would have fewer than 2 players. Reduce group count.');return}
  cData.groupAssign=groups;
  cData.groupQualifiers=groups.map(g=>Math.min(2,g.length-1));
  renderGroupBoxes();
}
function participantLabel(idx){
  if(cData.type==='1v1'){
    const db=getDB();const p=db.players.find(x=>x.id===cData.selected[idx]);
    return p?p.name:cData.selected[idx];
  }
  return cData.teams[idx]?cData.teams[idx].name:'';
}
function renderGroupBoxes(){
  const box=document.getElementById('group-boxes');if(!box)return;
  let html='';
  const total=cData.groupQualifiers.reduce((s,n)=>s+(n||0),0);
  const valid=[2,4,8,16].includes(total);
  html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;margin-bottom:10px;border-radius:10px;background:${valid?'rgba(46,204,113,0.08)':'rgba(255,71,87,0.08)'};border:1px solid ${valid?'var(--green)':'var(--red)'}">
    <span style="font-size:12px;font-weight:700;color:${valid?'var(--green)':'var(--red)'}">${valid?'✅':'⚠️'} Total Qualifiers: ${total}</span>
    <span style="font-size:11px;color:var(--sub)">${valid?'Ready for the Knockout Tree':'Must add up to exactly 2, 4, 8, or 16'}</span>
  </div>`;
  const numGroups=cData.groupAssign.length;
  cData.groupAssign.forEach((group,gi)=>{
    const letter=String.fromCharCode(65+gi);
    const qualifyField=group.length>0
      ?`<input type="number" min="1" max="${group.length-1}" value="${cData.groupQualifiers[gi]||1}" style="width:44px;background:var(--card2);border:1px solid var(--border);color:white;border-radius:4px;text-align:center;padding:2px" onchange="setGroupQualifiers(${gi},this.value)">`
      :`<span style="color:var(--red)">—</span>`;
    html+=`<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:800;color:var(--gold)">Group ${letter} (${group.length} player${group.length===1?'':'s'})</span>
        <span style="font-size:11px;color:var(--sub);display:flex;align-items:center;gap:6px">Qualify ${qualifyField}</span>
      </div>
      ${group.length===0?`<div style="font-size:11px;color:var(--sub);padding:4px 0">No players in this group yet — move some in using the letter buttons below.</div>`:''}
      <div style="display:flex;flex-direction:column;gap:6px">
        ${group.map(idx=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--card2);border-radius:8px;padding:7px 10px">
          <span style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${participantLabel(idx)}</span>
          <div style="display:flex;gap:4px;flex-shrink:0">
            ${Array.from({length:numGroups},(_,tgi)=>`<button onclick="moveParticipantTo(${gi},${idx},${tgi})" style="width:24px;height:24px;border-radius:6px;border:1.5px solid ${tgi===gi?'var(--gold)':'var(--border)'};background:${tgi===gi?'rgba(240,180,41,0.15)':'var(--card)'};color:${tgi===gi?'var(--gold)':'var(--sub)'};font-size:10px;font-weight:800;cursor:pointer;font-family:'Rajdhani',sans-serif">${String.fromCharCode(65+tgi)}</button>`).join('')}
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  });
  box.innerHTML=html;
}
function setGroupQualifiers(gi,val){
  const g=cData.groupAssign[gi];
  if(g.length===0)return;
  let n=parseInt(val)||1;
  n=Math.max(1,Math.min(g.length-1,n));
  cData.groupQualifiers[gi]=n;
  renderGroupBoxes();
}
// Move a player directly into a specific group (tap a group-letter button).
// This is how group sizes end up uneven/custom — no forced even split.
function moveParticipantTo(fromGi,idx,toGi){
  if(fromGi===toGi)return;
  const groups=cData.groupAssign;
  groups[fromGi]=groups[fromGi].filter(i=>i!==idx);
  groups[toGi].push(idx);
  cData.groupQualifiers=groups.map((g,gi)=>g.length===0?0:Math.min(cData.groupQualifiers[gi]||2,Math.max(1,g.length-1)));
  renderGroupBoxes();
}
function renderCreatePlayers(){
  const db=getDB();const sec=document.getElementById('create-players-section');
  const eligible=p=>!p.status||p.status==='active';
  if(cData.type==='1v1'){
    const pool=db.players.filter(eligible);
    if(pool.length===0){sec.innerHTML=`<div class="field"><label>Select Players</label><div style="font-size:13px;color:var(--sub);padding:6px 0">No eligible players yet (suspended/archived/banned players are hidden here).</div></div>`;return}
    sec.innerHTML=`<div class="field"><label>Select Players (min 2)</label><div style="font-size:11px;color:var(--sub);margin:-2px 0 8px">Suspended, archived, or banned players don't appear here.</div><div class="p-sel-list">
      ${pool.map(p=>{
        const sel=cData.selected.includes(p.id);
        return`<div class="p-sel-item ${sel?'sel':''}" onclick="toggleSel('${p.id}')">
          <div class="pav" style="width:32px;height:32px;font-size:11px">${p.photo?`<img src="${p.photo}" loading="lazy">`:`${initials(p.name)}`}</div>
          <div style="flex:1"><div style="font-size:13px;font-weight:700">${p.name}</div><div style="font-size:11px;color:var(--sub)">${p.id}</div></div>
          <div class="check">${sel?'✓':''}</div>
        </div>`;
      }).join('')}
    </div></div>`;
  } else {
    const pros=db.players.filter(p=>p.tier==='pro'&&eligible(p));
    const youths=db.players.filter(p=>p.tier!=='pro'&&eligible(p));
    const usedIds=cData.teams.flatMap(t=>[t.proId,t.youthId]);
    sec.innerHTML=`
      <div class="divider"></div>
      <div class="pot-lbl">⭐ PRO POT</div>
      <div class="pot-chips">${pros.map(p=>`<div class="p-chip${usedIds.includes(p.id)?' used':''}" data-id="${p.id}" data-tier="pro" onclick="selectPotPlayer(this)">${p.name}</div>`).join('')}${pros.length===0?`<span style="font-size:12px;color:var(--sub)">No PRO players</span>`:''}</div>
      <div class="pot-lbl">🌱 YOUTH POT</div>
      <div class="pot-chips">${youths.map(p=>`<div class="p-chip${usedIds.includes(p.id)?' used':''}" data-id="${p.id}" data-tier="youth" onclick="selectPotPlayer(this)">${p.name}</div>`).join('')}${youths.length===0?`<span style="font-size:12px;color:var(--sub)">No Youth players</span>`:''}</div>
      <div class="divider"></div>
      <div class="pot-lbl">Teams formed (${cData.teams.length})</div>
      <div class="formed-teams">
        ${cData.teams.map((t,i)=>`<div class="team-pair"><span>⭐ ${t.proName}</span><span style="color:var(--sub)">+</span><span>🌱 ${t.youthName}</span><button class="rm-team" onclick="removeTeam(${i})">✕</button></div>`).join('')}
        ${cData.teams.length===0?`<div style="font-size:12px;color:var(--sub)">Select a PRO then a YOUTH to form a team.</div>`:''}
      </div>`;
    if(pendingPro){const el=document.querySelector(`.p-chip[data-id="${pendingPro.id}"]`);if(el)el.classList.add('sp')}
  }
}
function toggleSel(pid){
  const idx=cData.selected.indexOf(pid);
  if(idx===-1)cData.selected.push(pid);else cData.selected.splice(idx,1);
  cData.groupAssign=null;cData.groupQualifiers=[];
  renderCreatePlayers();
  renderGroupConfig();
}
function selectPotPlayer(el){
  const id=el.dataset.id;const tier=el.dataset.tier;
  const db=getDB();const player=db.players.find(p=>p.id===id);if(!player)return;
  if(tier==='pro'){
    pendingPro={id,name:player.name};
    document.querySelectorAll('.p-chip[data-tier="pro"]').forEach(c=>c.classList.remove('sp'));
    el.classList.add('sp');snack('⭐ PRO: '+player.name+' — now pick a YOUTH');
  } else {
    if(!pendingPro){snack('Pick a PRO player first!');return}
    cData.teams.push({name:pendingPro.name+' & '+player.name,proId:pendingPro.id,proName:pendingPro.name,youthId:id,youthName:player.name});
    pendingPro=null;cData.groupAssign=null;cData.groupQualifiers=[];
    renderCreatePlayers();renderGroupConfig();
  }
}
function removeTeam(i){cData.teams.splice(i,1);cData.groupAssign=null;cData.groupQualifiers=[];renderCreatePlayers();renderGroupConfig()}

// ============================================================
// CREATE TOURNAMENT — WITH BUTTON LOCK
// ============================================================
async function createTournament(){
  hideErr('create-err');
  const name=document.getElementById('cup-name').value.trim();
  if(!name){showErr('create-err','Enter a cup name!');return}
  let participants;
  if(cData.type==='1v1'){
    if(cData.selected.length<2){showErr('create-err','Select at least 2 players!');return}
    participants=cData.selected;
  } else {
    if(cData.teams.length<2){showErr('create-err','Create at least 2 teams!');return}
    participants=cData.teams;
  }

  // 🛑 قفل الزر لمنع الضغط المزدوج
  const btn = document.querySelector('#modal-create .btn-gold');
  if(btn) { btn.innerHTML = '⏳ CREATING...'; btn.style.pointerEvents = 'none'; }
  function resetCreateBtn(){ if(btn){ btn.innerHTML='🏆 CREATE CUP'; btn.style.pointerEvents='auto'; } }

  const db=getDB();
  const standings=participants.map(p=>{
    if(cData.type==='1v1'){
      const pl=db.players.find(x=>x.id===p);
      return{id:p,name:pl?.name||p,PL:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,PTS:0};
    } else {
      return{id:p.proId+'::'+p.youthId,name:p.name,proId:p.proId,youthId:p.youthId,PL:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,PTS:0};
    }
  });

  const bannerData=document.getElementById('create-banner-data')?.value||'';
  const logoData=document.getElementById('create-logo-data')?.value||'';
  let t={id:Date.now(),name,format:cData.format,type:cData.type,category:cData.category||'official',participants,standings,matches:[],status:'active',banner:bannerData,logo:logoData,themeColor:cData.themeColor||'#f0b429'};
  const n=participants.length;

  if(cData.format==='groups'){
    if(!cData.groupAssign){showErr('create-err','Distribute the players into groups first!');resetCreateBtn();return}
    if(cData.groupAssign.some(g=>g.length<2)){showErr('create-err','Every group needs at least 2 players!');resetCreateBtn();return}
    const totalQualifiers=cData.groupQualifiers.reduce((s,x)=>s+(x||0),0);
    if(![2,4,8,16].includes(totalQualifiers)){
      showErr('create-err',`The total qualifiers across all groups is ${totalQualifiers} — it must add up to exactly 2, 4, 8, or 16 to build a valid Knockout Tree. Adjust the "Qualify" number in each group.`);
      resetCreateBtn();return;
    }
    const groups=cData.groupAssign.map((idxArr,gi)=>{
      const ids=idxArr.map(i=>standings[i].id);
      idxArr.forEach(i=>{standings[i].group=gi;});
      const size=idxArr.length;
      let qual=cData.groupQualifiers[gi]||2;
      qual=Math.max(1,Math.min(size-1,qual));
      return{name:`Group ${String.fromCharCode(65+gi)}`,ids,qualifiers:qual};
    });
    t.groups=groups;
    t.phase='groups';
    t.schedule=generateGroupSchedules(groups,cData.legs);
    t.autoQualify=!!cData.autoQualify;
  } else if(![2,4,8,16].includes(n)){
    t.format='league'; t.phase='group'; t.schedule=generateRoundRobin(standings,cData.type);
    snack('⚠️ Odd number! Forced League format (Double Leg).');
  } else {
    if(cData.format==='tree'){
      t.phase='elimination'; t.bracket=generateBracket(standings.map(s=>s.id),cData.type);
    } else {
      t.phase='group'; t.schedule=generateRoundRobin(standings,cData.type);
    }
  }

  db.tournaments.unshift(t);

  await saveSingleTournament(t);
  localStorage.setItem(DB_KEY, JSON.stringify(db));

  addNews(`🏆 New tournament created: "${name}" with ${participants.length} ${cData.type==='2v2'?'teams':'players'}!`,'🏆');
  
  if(btn) { btn.innerHTML = '🏆 CREATE CUP'; btn.style.pointerEvents = 'auto'; }
  closeModal('modal-create');snack('🏆 "'+name+'" created!');renderArena();
}

// Generate all round-robin matchups (each pair plays twice)
function generateRoundRobin(standings,type){
  const ids=standings.map(s=>s.id);
  const schedule=[];
  for(let i=0;i<ids.length;i++){
    for(let j=i+1;j<ids.length;j++){
      schedule.push({aId:ids[i],bId:ids[j],leg:1,played:false});
      schedule.push({aId:ids[j],bId:ids[i],leg:2,played:false});
    }
  }
  return schedule;
}

// Generate round-robin schedules for each group separately, tagged with group index
function generateGroupSchedules(groups,legs){
  legs=legs===1?1:2;
  const schedule=[];
  groups.forEach((g,gi)=>{
    const ids=g.ids;
    for(let i=0;i<ids.length;i++){
      for(let j=i+1;j<ids.length;j++){
        schedule.push({aId:ids[i],bId:ids[j],leg:1,played:false,group:gi});
        if(legs===2)schedule.push({aId:ids[j],bId:ids[i],leg:2,played:false,group:gi});
      }
    }
  });
  return schedule;
}

// Generate elimination bracket
function generateBracket(playerIds,type){
  const shuffled=[...playerIds].sort(()=>Math.random()-0.5);
  const size=Math.pow(2,Math.ceil(Math.log2(shuffled.length)));
  while(shuffled.length<size)shuffled.push(null);
  const rounds=[];
  let current=[];
  for(let i=0;i<shuffled.length;i+=2){
    current.push({p1:shuffled[i],p2:shuffled[i+1],winner:null,score1:null,score2:null});
  }
  rounds.push(current);
  while(current.length>1){
    const next=[];
    for(let i=0;i<current.length;i+=2){
      next.push({p1:null,p2:null,winner:null,score1:null,score2:null,feedFrom:[rounds.length-1,i,i+1]});
    }
    rounds.push(next);
    current=next;
  }
  return rounds;
}

// ============================================================
// QUICK FRIENDLY CHALLENGE — shortcut that auto-creates a minimal
// 2-player Friendly-category tournament (reusing all the existing
// tournament/match infrastructure) and jumps straight into recording
// the result, instead of a whole separate parallel system.
// ============================================================
function openFriendlyChallenge(){
  const db=getDB();
  const eligible=db.players.filter(p=>!p.status||p.status==='active');
  hideErr('challenge-err');
  if(eligible.length<2){
    document.getElementById('challenge-body').innerHTML=`<div style="font-size:12px;color:var(--sub);padding:10px 0">Need at least 2 active players to start a challenge.</div>`;
    document.getElementById('modal-challenge').classList.add('active');
    return;
  }
  const opts=eligible.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  document.getElementById('challenge-body').innerHTML=`
    <div class="field"><label>Player 1</label><select id="chal-a" class="select-field"><option value="">— Select —</option>${opts}</select></div>
    <div class="field"><label>Player 2</label><select id="chal-b" class="select-field"><option value="">— Select —</option>${opts}</select></div>`;
  document.getElementById('modal-challenge').classList.add('active');
}

async function createFriendlyChallenge(){
  hideErr('challenge-err');
  const aId=document.getElementById('chal-a')?.value;
  const bId=document.getElementById('chal-b')?.value;
  if(!aId||!bId){showErr('challenge-err','Pick both players!');return}
  if(aId===bId){showErr('challenge-err','Pick two different players!');return}

  const db=getDB();
  const pA=db.players.find(x=>x.id===aId), pB=db.players.find(x=>x.id===bId);
  if(!pA||!pB)return;

  const btn=document.querySelector('#modal-challenge .btn-gold');
  if(btn){btn.innerHTML='⏳ STARTING...';btn.style.pointerEvents='none';}

  const standings=[
    {id:aId,name:pA.name,PL:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,PTS:0},
    {id:bId,name:pB.name,PL:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,PTS:0}
  ];
  const t={
    id:Date.now(),
    name:`${pA.name} vs ${pB.name} — Friendly`,
    format:'league',type:'1v1',category:'friendly',
    participants:[aId,bId],standings,matches:[],status:'active',
    phase:'group',
    schedule:[{aId,bId,leg:1,played:false}]
  };

  db.tournaments.unshift(t);
  await saveSingleTournament(t);
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  addNews(`🤝 Friendly challenge kicked off: ${pA.name} vs ${pB.name}!`,'🤝');

  if(btn){btn.innerHTML='🤝 START CHALLENGE';btn.style.pointerEvents='auto';}
  closeModal('modal-challenge');
  renderArena();

  // Jump straight into recording the result
  const idx=db.tournaments.indexOf(t);
  openTournament(idx);
  openRecord();
}

// ============================================================
// TOURNAMENT SCREEN — Updated to show Qualify button
// ============================================================
function openTournament(idx){activeTournIdx=idx;renderTournamentScreen();showScreen('screen-tournament')}
function backToApp(){activeTournIdx=null;showScreen('screen-app');renderArena()}
function getTournament(){if(activeTournIdx===null)return null;return getDB().tournaments[activeTournIdx]}

function renderTournamentScreen(){
  const t=getTournament();if(!t)return;
  const logoHtmlScr=t.logo?`<img src="${t.logo}" style="width:22px;height:22px;border-radius:6px;object-fit:cover;vertical-align:middle;margin-right:7px">`:'';
  document.getElementById('t-scr-name').innerHTML=`${logoHtmlScr}${t.name}`;
  const hdrEl=document.querySelector('.t-scr-hdr');
  if(hdrEl){
    if(t.banner){
      hdrEl.style.backgroundImage=`linear-gradient(180deg, rgba(4,4,13,0.5) 0%, rgba(4,4,13,0.93) 100%), url('${t.banner}')`;
      hdrEl.style.backgroundSize='cover';
      hdrEl.style.backgroundPosition='center';
    } else {
      hdrEl.style.backgroundImage='';
      hdrEl.style.backgroundSize='';
      hdrEl.style.backgroundPosition='';
    }
    hdrEl.style.setProperty('--gold', t.themeColor||'#f0b429');
  }
  const archTag=t.archivedAt?' · <span style="color:var(--sub)">📦 ARCHIVED</span>':'';
  const catTagScr=t.category==='friendly'?' · <span style="color:var(--gold)">🤝 Friendly</span>':t.category==='qualifier'?' · <span style="color:var(--blue)">🎯 Qualifier</span>':'';
  document.getElementById('t-scr-meta').innerHTML=`${t.type.toUpperCase()} · ${t.format==='league'?'🏅 League':'🌳 Elimination'} · <span style="color:${t.status==='active'?'var(--green)':'var(--sub)'}">● ${t.status==='active'?'LIVE':'ENDED'}</span>${catTagScr}${archTag}`;
  renderNextMatch(t);
  renderStandings();
  renderMatchHistory();

  const ctrl=document.getElementById('admin-ctrl');
  const isAdmin=currentUser?.type==='admin';
  ctrl.style.display=isAdmin?'block':'none';
  const isActive=t.status==='active';
  const btnRecord=document.getElementById('btn-record'); if(btnRecord)btnRecord.style.display=isActive?'':'none';
  const btnEditLast=document.getElementById('btn-edit-last');
  if(btnEditLast)btnEditLast.style.display=(isActive&&t.phase!=='elimination'&&t.matches&&t.matches.length>0)?'':'none';
  const btnEnd=document.getElementById('btn-end');
  if(btnEnd){
    btnEnd.style.display=isActive?'':'none';
    btnEnd.innerHTML=isRewardTournament(t)?'🔴 END CUP & AWARD TROPHY':'🔴 END (NO CUP — QUALIFIER/FRIENDLY)';
  }
  const btnArchiveT=document.getElementById('btn-archive-t');
  if(btnArchiveT)btnArchiveT.textContent=t.archivedAt?'✅ UN-ARCHIVE TOURNAMENT':'📦 ARCHIVE TOURNAMENT';

  // Show Qualify button only when in group phase AND there are actually
  // enough participants for it to ever pass validation (a 2-player quick
  // friendly challenge has nothing to "qualify" to a knockout tree).
  const qBtn=document.getElementById('btn-qualify');
  if(qBtn){
    qBtn.style.display=(isActive&&(t.phase==='group'||t.phase==='groups')&&t.participants.length>2)?'flex':'none';
    qBtn.innerHTML=t.phase==='groups'?'⚡ QUALIFY GROUP WINNERS':'⚡ QUALIFY TOP PLAYERS';
  }
}

// ============================================================
// QUALIFY TO KNOCKOUT — New function
// ============================================================
// ============================================================
// QUALIFY TO KNOCKOUT ASYNC FIX
// ============================================================
async function qualifyToKnockout(){
  const db=getDB();
  const t=db.tournaments[activeTournIdx];
  if(!t)return;
  if(t.phase==='groups')return qualifyGroupsToKnockout(db,t);
  if(t.phase!=='group')return;

  const qNum=parseInt(prompt('How many players qualify to the Knockout Tree?\nEnter 2, 4, 8, or 16:'));
  if(![2,4,8,16].includes(qNum)){snack('⚠️ Enter 2, 4, 8, or 16');return}
  if(qNum>=t.participants.length){snack('⚠️ Number must be less than total players');return}

  if(!confirm(`Qualify Top ${qNum} players to the Knockout Tree?`))return;

  const sorted=sortedStandings(t);
  const topPlayers=sorted.slice(0,qNum).map(s=>s.id);

  t.phase='elimination';
  t.bracket=generateBracket(topPlayers,t.type);

  // AWAIT THE SERVER BEFORE UPDATING UI
  await saveSingleTournament(t);
  localStorage.setItem(DB_KEY, JSON.stringify(db));

  addNews(`⚡ Top ${qNum} players qualified to the Knockout stage of "${t.name}"!`,'⚡');
  snack(`✅ Top ${qNum} qualified! Bracket generated.`);
  renderTournamentScreen();
}

async function qualifyGroupsToKnockout(db,t){
  if(!t.groups||!t.groups.length){snack('⚠️ No groups found on this tournament.');return}
  const unplayed=(t.schedule||[]).filter(m=>!m.played).length;

  let qualifiedIds=[];
  let previewLines=[];
  t.groups.forEach((g,gi)=>{
    const groupStandings=t.standings.filter(s=>s.group===gi).sort((a,b)=>compareStandings(t,a,b));
    const n=g.qualifiers||2;
    const picks=groupStandings.slice(0,n);
    qualifiedIds.push(...picks.map(s=>s.id));
    previewLines.push(`${g.name}: ${picks.map(s=>s.name).join(', ')}`);
  });
  if(qualifiedIds.length<2){snack('⚠️ Not enough qualifiers to build a bracket!');return}
  if(![2,4,8,16].includes(qualifiedIds.length)){
    snack(`⚠️ Total qualifiers is ${qualifiedIds.length} — it must be exactly 2, 4, 8, or 16. Adjust each group's qualifier count and try again.`);
    return;
  }

  const headerMsg = unplayed>0
    ? `⚠️ ${unplayed} group-stage match(es) are still unplayed.\n\n`
    : `🎉 All group matches are complete!\n\n`;
  const confirmMsg = `${headerMsg}Qualifiers for the Knockout Tree:\n${previewLines.join('\n')}\n\nGenerate the tree now?`;
  if(!confirm(confirmMsg))return;

  t.phase='elimination';
  t.bracket=generateBracket(qualifiedIds,t.type);

  await saveSingleTournament(t);
  localStorage.setItem(DB_KEY, JSON.stringify(db));

  addNews(`⚡ Group stage complete for "${t.name}"! ${qualifiedIds.length} qualified to the Knockout Tree.`,'⚡');
  snack(`✅ ${qualifiedIds.length} qualified! Bracket generated.`);
  renderTournamentScreen();
}

function renderNextMatch(t){
  const section=document.getElementById('next-match-section');
  if(!t.schedule&&!t.bracket){section.innerHTML='';return}
  let nextA='',nextB='',roundLabel='';
  if((t.phase==='group'||t.phase==='groups')&&t.schedule){
    const next=t.schedule.find(m=>!m.played);
    if(next){
      const sA=t.standings.find(s=>s.id===next.aId);
      const sB=t.standings.find(s=>s.id===next.bId);
      nextA=sA?.name||next.aId;nextB=sB?.name||next.bId;
      const gName=(t.phase==='groups'&&t.groups&&t.groups[next.group])?t.groups[next.group].name+' · ':'';
      roundLabel=`${gName}Matchday · Leg ${next.leg}`;
    }
  } else if(t.bracket){
    for(let r=0;r<t.bracket.length;r++){
      const match=t.bracket[r].find(m=>m.p1&&m.p2&&m.winner===null);
      if(match){
        const getN=id=>{const s=t.standings.find(x=>x.id===id);return s?.name||id};
        nextA=getN(match.p1);nextB=getN(match.p2);
        const rNames=['Round of 32','Round of 16','Quarter-Final','Semi-Final','Final'];
        roundLabel=rNames[r]||`Round ${r+1}`;
        break;
      }
    }
  }
  if(!nextA){section.innerHTML='';return}
  section.innerHTML=`<div class="next-match-card">
    <div class="nmc-title">⚡ Next Match</div>
    <div class="nmc-teams">
      <div class="nmc-team">${nextA}</div>
      <div class="nmc-vs">VS</div>
      <div class="nmc-team">${nextB}</div>
    </div>
    <div class="nmc-round">${roundLabel}</div>
  </div>`;
}

// ============================================================
// STANDINGS COMPARATOR — PTS, then Head-to-Head, then GD, then GF
// ============================================================
function headToHeadPts(t,idA,idB){
  let ptsA=0,ptsB=0;
  (t.matches||[]).forEach(m=>{
    if(m.aId===idA&&m.bId===idB){
      if(m.goalsA>m.goalsB)ptsA+=3;else if(m.goalsA<m.goalsB)ptsB+=3;else{ptsA++;ptsB++;}
    } else if(m.aId===idB&&m.bId===idA){
      if(m.goalsA>m.goalsB)ptsB+=3;else if(m.goalsA<m.goalsB)ptsA+=3;else{ptsA++;ptsB++;}
    }
  });
  return{ptsA,ptsB};
}
function compareStandings(t,a,b){
  if(b.PTS!==a.PTS)return b.PTS-a.PTS;
  const h2h=headToHeadPts(t,a.id,b.id);
  if(h2h.ptsA!==h2h.ptsB)return h2h.ptsB-h2h.ptsA;
  if(b.GD!==a.GD)return b.GD-a.GD;
  return(b.GF||0)-(a.GF||0);
}
function sortedStandings(t){return[...t.standings].sort((a,b)=>compareStandings(t,a,b))}

function renderStandings(){
  const t=getTournament();if(!t)return;
  const content=document.getElementById('standings-content');
  if(t.phase==='elimination'&&t.bracket){
    document.getElementById('standings-sub-hdr').textContent='🌳 Bracket';
    content.innerHTML=`<div class="bracket-scroll"><div class="bracket-container" id="bracket-inner"></div></div>`;
    renderBracket(t);
  } else if(t.phase==='groups'&&t.groups){
    document.getElementById('standings-sub-hdr').textContent='🧩 Group Stage';
    renderGroupsStandings(t,content);
  } else {
    document.getElementById('standings-sub-hdr').textContent='📊 Live Standings';
    renderLeagueTable(t,content);
  }
}

// ============================================================
// REAL GROUP-STAGE STANDINGS RENDERER (separate table per group)
// ============================================================
function renderGroupsStandings(t,content){
  const db=getDB();
  let html='';
  t.groups.forEach((g,gi)=>{
    const sorted=t.standings.filter(s=>s.group===gi).sort((a,b)=>compareStandings(t,a,b));
    const qual=g.qualifiers||2;
    html+=`<div style="margin-bottom:20px">
      <div style="font-weight:800;color:var(--gold);font-size:14px;margin-bottom:8px">${g.name} <span style="color:var(--sub);font-weight:600;font-size:11px">— Top ${qual} qualify</span></div>
      <table class="standings-table">
        <thead><tr><th>#</th><th style="text-align:left">Club / Player</th><th>PL</th><th>GD</th><th>PTS</th></tr></thead>
        <tbody>${sorted.map((p,i)=>{
          const rowClass=i<qual?'row-blue':'';
          return`<tr class="${rowClass}" onclick="openProfileByName('${encodeURIComponent(p.name)}')">
            <td><span class="s-rank ${i===0?'g':''}">${i===0?'👑':i+1}</span></td>
            <td style="text-align:left"><div style="display:flex;align-items:center;gap:10px">${getMiniAv(p.id,t,db)}<span style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px">${p.name}</span></div></td>
            <td style="font-weight:700;color:var(--sub)">${p.PL}</td>
            <td style="font-weight:700;color:${p.GD>0?'var(--green)':p.GD<0?'var(--red)':'var(--sub)'}">${p.GD>0?'+':''}${p.GD}</td>
            <td style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--gold);text-shadow:0 0 10px rgba(240,180,41,0.2)">${p.PTS}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  });
  content.innerHTML=html;
}

// ============================================================
// INTERACTIVE LEAGUE TABLE RENDERER
// ============================================================
function renderLeagueTable(t,content){
  const db = getDB();
  const sorted=sortedStandings(t);
  const n=sorted.length;
  const topCount=2;
  let relegCount=0;
  if(n>4)relegCount=Math.max(1,Math.floor(n*0.25));

  content.innerHTML=`<table class="standings-table">
    <thead>
      <tr>
        <th>#</th>
        <th style="text-align:left">Club / Player</th>
        <th>Form</th>
        <th>PL</th>
        <th>GD</th>
        <th>PTS</th>
      </tr>
    </thead>
    <tbody>${sorted.map((p,i)=>{
      let rowClass='';
      if(i<topCount)rowClass='row-blue';
      else if(i>=n-relegCount&&relegCount>0)rowClass='row-relegation';
      
      let formHTML = '';
      if(t.type === '1v1') {
          formHTML = getPlayerForm(p.id, db);
          if(!formHTML) formHTML = '<span style="font-size:10px;color:var(--sub)">-</span>';
      } else {
          formHTML = '<div style="font-size:9px;color:var(--sub);font-weight:700">DUO</div>'; 
      }

      return`<tr class="${rowClass}" onclick="openProfileByName('${encodeURIComponent(p.name)}')">
        <td><span class="s-rank ${i===0?'g':''}">${i===0?'👑':i+1}</span></td>
        <td style="text-align:left">
          <div style="display:flex;align-items:center;gap:10px">
            ${getMiniAv(p.id, t, db)}
            <span style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px">${p.name}</span>
          </div>
        </td>
        <td><div style="display:flex;gap:2px;justify-content:center">${formHTML}</div></td>
        <td style="font-weight:700;color:var(--sub)">${p.PL}</td>
        <td style="font-weight:700;color:${p.GD>0?'var(--green)':p.GD<0?'var(--red)':'var(--sub)'}">${p.GD>0?'+':''}${p.GD}</td>
        <td style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--gold);text-shadow:0 0 10px rgba(240,180,41,0.2)">${p.PTS}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>
  ${topCount>0?`<div style="display:flex;gap:12px;margin-top:16px;font-size:11px;font-weight:700;background:rgba(17,17,37,0.8);padding:12px;border-radius:12px;border:1px solid var(--border);justify-content:center">
    <span style="color:var(--blue)">🔵 Top ${topCount} — Home Advantage</span>
    ${relegCount>0?`<span style="color:var(--red)">🔴 Relegation Zone</span>`:''}
  </div>`:''}`;
}

// ============================================================
// ADVANCED BRACKET RENDERER
// ============================================================
function renderBracket(t){
  const el=document.getElementById('bracket-inner');if(!el)return;
  if(!t.bracket){el.innerHTML='<div style="color:var(--sub);font-size:13px;padding:20px;text-align:center;width:100%">Bracket will be generated after group stage.</div>';return}
  
  const rNames=['Round 1','Round of 16','Quarter-Finals','Semi-Finals','The Final'];
  const getN=id=>{if(!id)return'TBD';const s=t.standings.find(x=>x.id===id);return s?.name||id};
  
  let html='';
  t.bracket.forEach((round,ri)=>{
    const name=rNames[Math.max(0,rNames.length-(t.bracket.length-ri))];
    html+=`<div class="bracket-round-wrap">
      <div class="bracket-round-title">${name}</div>
      <div class="bracket-round">`;
      
    round.forEach(m=>{
      const w=m.winner;
      const cls=w?'b-match winner-match':'b-match';
      const n1=getN(m.p1);const n2=getN(m.p2||null);
      const isTbd1=!m.p1;const isTbd2=!m.p2;
      
      html+=`<div class="${cls}">
        <div class="b-player">
          <div style="display:flex;align-items:center;gap:8px;overflow:hidden">
            ${getMiniAv(m.p1, t, getDB())}
            <span class="${m.winner===m.p1?'b-winner':''} ${isTbd1?'b-tbd':''}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n1}</span>
          </div>
          ${m.score1!==null?`<span class="b-score">${m.score1}</span>`:''}
        </div>
        <div class="b-player">
          <div style="display:flex;align-items:center;gap:8px;overflow:hidden">
            ${getMiniAv(m.p2, t, getDB())}
            <span class="${m.winner===m.p2?'b-winner':''} ${isTbd2?'b-tbd':''}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${isTbd2?'TBD':n2}</span>
          </div>
          ${m.score2!==null?`<span class="b-score">${m.score2}</span>`:''}
        </div>
      </div>`;
    });
    
    html+='</div></div>';
    
    if(ri<t.bracket.length-1){
      html+=`<div class="bracket-connector">
        <svg width="100%" height="100%" style="position:absolute;inset:0" preserveAspectRatio="none">
          <path d="M0,25 L17,25 L17,75 L35,75" stroke="rgba(255,255,255,0.12)" fill="none" stroke-width="2"/>
        </svg>
      </div>`;
    }
  });
  el.innerHTML=html;
}

function openProfileByName(encodedName){
  const name=decodeURIComponent(encodedName);
  const db=getDB();
  const idx=db.players.findIndex(p=>p.name===name);
  if(idx>=0)openProfile(idx,false);
}

function renderMatchHistory(){
  const t=getTournament();if(!t)return;
  const el=document.getElementById('match-history');
  if(t.matches.length===0){el.innerHTML='<div style="font-size:13px;color:var(--sub);text-align:center;padding:14px 0">No matches recorded yet.</div>';return}
  el.innerHTML=[...t.matches].reverse().map((m,ri)=>{
    const origIdx=t.matches.length-1-ri;
    const motm=m.motm?`<div class="motm-badge">⭐ ${m.motm}</div>`:'';
    const hasVoted=m.votes&&m.votes[currentUser?.id||''];
    const canVote=currentUser&&t.status==='active'&&!hasVoted;
    return`<div class="mh-item" onclick="openMotmVote(${origIdx})">
      <div class="mh-teams">
        <div style="display:flex;align-items:center;gap:6px;flex:1">
          ${getMiniAv(m.aId, t, getDB())}
          <span style="font-weight:${m.goalsA>m.goalsB?700:400};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.teamA}</span>
        </div>
        <div class="mh-score">${m.goalsA} – ${m.goalsB}</div>
        <div style="display:flex;align-items:center;gap:6px;flex:1;justify-content:flex-end">
          <span style="font-weight:${m.goalsB>m.goalsA?700:400};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right">${m.teamB}</span>
          ${getMiniAv(m.bId, t, getDB())}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;margin-left:8px">
        ${motm}
        ${canVote?`<div style="font-size:9px;color:var(--gold);font-weight:700;letter-spacing:0.5px">TAP TO VOTE</div>`:''}
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// RECORD MATCH
// ============================================================
// ============================================================
// THE MASTER MATCH CONSOLE (Replaces old openRecord)
// ============================================================
function openRecord(){
  const t=getTournament();if(!t)return;
  hideErr('rec-err');
  let poolStandings=t.standings;
  if(t.phase==='elimination'&&t.bracket){
    const activeIds=new Set();
    t.bracket.forEach(round=>{
      round.forEach(m=>{
        if(m.p1&&!m.winner)activeIds.add(m.p1);
        if(m.p2&&!m.winner)activeIds.add(m.p2);
        if(m.winner)activeIds.add(m.winner);
      });
    });
    poolStandings=t.standings.filter(s=>activeIds.has(s.id));
  }
  const opts=poolStandings.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  let scheduleHint='';
  if((t.phase==='group'||t.phase==='groups')&&t.schedule){
    const next=t.schedule.find(m=>!m.played);
    if(next){
      const sA=t.standings.find(s=>s.id===next.aId);
      const sB=t.standings.find(s=>s.id===next.bId);
      const gName=(t.phase==='groups'&&t.groups&&t.groups[next.group])?t.groups[next.group].name+' — ':'';
      scheduleHint=`<div style="background:rgba(240,180,41,0.08);border:1px solid rgba(240,180,41,0.15);border-radius:9px;padding:10px 14px;margin-bottom:12px;font-size:13px">
        <span style="color:var(--gold);font-weight:700">📅 ${gName}Scheduled: </span>${sA?.name} vs ${sB?.name} (Leg ${next.leg})
        <button onclick="autoFillScheduled('${next.aId}','${next.bId}')" style="margin-left:8px;background:rgba(240,180,41,0.1);color:var(--gold);border:1px solid rgba(240,180,41,0.2);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:'Rajdhani',sans-serif">AUTO-FILL</button>
      </div>`;
    }
  }
  document.getElementById('record-body').innerHTML=`
    ${scheduleHint}
    <div class="field"><label>Home</label><select class="select-field" id="rec-a" onchange="buildMatchConsole()"><option value="">— Select —</option>${opts}</select></div>
    <div class="field"><label>Away</label><select class="select-field" id="rec-b" onchange="buildMatchConsole()"><option value="">— Select —</option>${opts}</select></div>
    <div id="master-console" style="margin-top:15px"></div>
    <div style="margin-top:15px; border-top:1px solid var(--border); padding-top:15px">
      <div style="font-size:10px; font-weight:700; color:var(--red); margin-bottom:8px; letter-spacing:1px">⚠️ FORFEIT (WALKOVER)</div>
      <div style="display:flex; gap:10px">
        <button class="btn btn-ghost" style="color:var(--red); border-color:rgba(255,71,87,0.3); font-size:12px; padding:10px" onclick="submitWithdraw('a')">Home Withdrew</button>
        <button class="btn btn-ghost" style="color:var(--red); border-color:rgba(255,71,87,0.3); font-size:12px; padding:10px" onclick="submitWithdraw('b')">Away Withdrew</button>
      </div>
    </div>`;
  document.getElementById('modal-record').classList.add('active');
}

function buildMatchConsole() {
    const t = getTournament();
    const aId = document.getElementById('rec-a').value;
    const bId = document.getElementById('rec-b').value;
    const consoleDiv = document.getElementById('master-console');

    if(!aId || !bId || aId === bId) {
        consoleDiv.innerHTML = '';
        return;
    }

    const tA = t.standings.find(p => p.id === aId);
    const tB = t.standings.find(p => p.id === bId);

    if(t.phase==='groups' && tA.group!==tB.group){
        const gAName = t.groups?.[tA.group]?.name || '?';
        const gBName = t.groups?.[tB.group]?.name || '?';
        consoleDiv.innerHTML = `<div style="color:var(--red);font-size:13px;padding:12px;background:rgba(255,71,87,0.08);border:1px solid rgba(255,71,87,0.2);border-radius:8px">⚠️ ${tA.name} is in ${gAName} and ${tB.name} is in ${gBName} — group-stage matches can only be recorded between two players in the <strong>same group</strong>.</div>`;
        return;
    }

    const cardPill=(pid,type,label)=>{
        const chkId=`${type}-${pid}`;
        return `<span class="p-chip" style="padding:6px 12px;font-size:15px" onclick="toggleCardBtn(this,'${chkId}','${type==='y'?'var(--gold)':'var(--red)'}')">${label}</span><input type="checkbox" id="${chkId}" style="display:none">`;
    };

    if(t.type === '1v1') {
        consoleDiv.innerHTML = `
            <div class="score-row">
              <div class="score-team" style="color:var(--sub)">${tA.name}</div>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="p-chip" style="padding:4px 10px;font-weight:800" onclick="stepNum('sc-a',-1)">−</span>
                <input type="number" id="sc-a" class="score-in" value="0" min="0" max="99">
                <span class="p-chip" style="padding:4px 10px;font-weight:800" onclick="stepNum('sc-a',1)">+</span>
              </div>
              <div class="score-vs">VS</div>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="p-chip" style="padding:4px 10px;font-weight:800" onclick="stepNum('sc-b',-1)">−</span>
                <input type="number" id="sc-b" class="score-in" value="0" min="0" max="99">
                <span class="p-chip" style="padding:4px 10px;font-weight:800" onclick="stepNum('sc-b',1)">+</span>
              </div>
              <div class="score-team" style="color:var(--sub)">${tB.name}</div>
            </div>
            <div class="settings-card" style="padding:12px;margin-top:10px;margin-bottom:0">
                <div class="settings-title" style="font-size:11px">🟨🟥 Cards</div>
                <div style="display:flex; justify-content:space-between; align-items:center">
                    <div>
                        <span style="color:var(--sub); font-size:10px; display:block; margin-bottom:6px">${tA.name}</span>
                        <div style="display:flex;gap:6px">${cardPill(aId,'y','🟨')}${cardPill(aId,'r','🟥')}</div>
                    </div>
                    <div style="text-align:right">
                        <span style="color:var(--sub); font-size:10px; display:block; margin-bottom:6px">${tB.name}</span>
                        <div style="display:flex;gap:6px;justify-content:flex-end">${cardPill(bId,'y','🟨')}${cardPill(bId,'r','🟥')}</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        const renderPlayerRow = (pid, pname) => `
            <div style="display:flex; align-items:center; justify-content:space-between; background:var(--card2); padding:10px 12px; margin-bottom:6px; border-radius:10px; border:1px solid var(--border)">
                <div style="font-size:13px; font-weight:700; width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${pname}</div>
                <div style="display:flex; align-items:center; gap:8px">
                    <span class="p-chip" style="padding:4px 9px;font-weight:800" onclick="stepNum('g-${pid}',-1)">−</span>
                    ⚽ <input type="number" id="g-${pid}" value="0" min="0" style="width:36px; background:var(--card); border:1px solid var(--border); color:white; border-radius:6px; text-align:center; font-family:'Bebas Neue', sans-serif; font-size:16px; padding:4px">
                    <span class="p-chip" style="padding:4px 9px;font-weight:800" onclick="stepNum('g-${pid}',1)">+</span>
                    ${cardPill(pid,'y','🟨')}${cardPill(pid,'r','🟥')}
                </div>
            </div>
        `;
        
        consoleDiv.innerHTML = `
            <div class="settings-card" style="padding:12px;margin-bottom:8px">
              <div class="settings-title" style="font-size:11px;color:var(--gold)">🏠 HOME — ${tA.name}</div>
              ${renderPlayerRow(tA.proId, tA.proName)}
              ${renderPlayerRow(tA.youthId, tA.youthName)}
            </div>
            <div class="settings-card" style="padding:12px;margin-bottom:0">
              <div class="settings-title" style="font-size:11px;color:var(--gold)">🚀 AWAY — ${tB.name}</div>
              ${renderPlayerRow(tB.proId, tB.proName)}
              ${renderPlayerRow(tB.youthId, tB.youthName)}
            </div>
        `;
    }
}
function stepNum(id,delta){
    const el=document.getElementById(id);if(!el)return;
    let v=(parseInt(el.value)||0)+delta;
    if(v<0)v=0;
    el.value=v;
}
function toggleCardBtn(btn,chkId,activeColor){
    const chk=document.getElementById(chkId);if(!chk)return;
    chk.checked=!chk.checked;
    if(chk.checked){btn.style.background=activeColor+'22';btn.style.borderColor=activeColor;btn.style.color=activeColor;}
    else{btn.style.background='';btn.style.borderColor='';btn.style.color='';}
}

function autoFillScheduled(aId,bId){
  const t=getTournament();if(!t)return;
  document.getElementById('rec-a').value=aId;
  document.getElementById('rec-b').value=bId;
  buildMatchConsole(); 
}

function submitWithdraw(whoQuit) {
    const t = getTournament();
    if(!t) return;
    const aId = document.getElementById('rec-a').value;
    const bId = document.getElementById('rec-b').value;
    if(!aId || !bId) { snack('⚠️ Select the players first!'); return; }
    
    // 🔒 Lock: Prevent clicking before the input fields exist
    if(t.type === '1v1' && !document.getElementById('sc-a')) return;
    if(t.type === '2v2') { const _s = t.standings.find(p=>p.id===aId); if(!_s || !document.getElementById(`g-${_s.proId}`)) return; }
    
    if(t.type === '1v1') {
        if(whoQuit === 'a') { document.getElementById('sc-a').value = 0; document.getElementById('sc-b').value = 3; } 
        else { document.getElementById('sc-a').value = 3; document.getElementById('sc-b').value = 0; }
    } else {
        const tA = t.standings.find(p => p.id === aId);
        const tB = t.standings.find(p => p.id === bId);
        if(whoQuit === 'a') {
            document.getElementById(`g-${tA.proId}`).value = 0; document.getElementById(`g-${tA.youthId}`).value = 0;
            document.getElementById(`g-${tB.proId}`).value = 3; document.getElementById(`g-${tB.youthId}`).value = 0;
        } else {
            document.getElementById(`g-${tA.proId}`).value = 3; document.getElementById(`g-${tA.youthId}`).value = 0;
            document.getElementById(`g-${tB.proId}`).value = 0; document.getElementById(`g-${tB.youthId}`).value = 0;
        }
    }
    snack('⚠️ Walkover applied: 3 - 0. Click SAVE RESULT.');
}

// ============================================================
// THE SMART SAVE ENGINE (With Market Value Automation)
// ============================================================
// ============================================================
// THE SMART SAVE ENGINE (WITH BUTTON LOCK)
// ============================================================
async function saveMatch(){
  hideErr('rec-err');
  const aId=document.getElementById('rec-a').value;
  const bId=document.getElementById('rec-b').value;
  if(!aId||!bId){showErr('rec-err','Select both teams/players.');return}
  if(aId===bId){showErr('rec-err','Cannot play against yourself!');return}
  
  const db=getDB();
  const t=db.tournaments[activeTournIdx];
  if(!t) return;
  const tA=t.standings.find(p=>p.id===aId);
  const tB=t.standings.find(p=>p.id===bId);
  if(!tA||!tB) return;

  if(t.phase==='groups' && tA.group!==tB.group){
    showErr('rec-err','These two players are in different groups — you can only record matches within the same group.');
    return;
  }

  let goalsA = 0, goalsB = 0;
  if(t.type === '1v1') {
      goalsA = parseInt(document.getElementById('sc-a').value)||0;
      goalsB = parseInt(document.getElementById('sc-b').value)||0;
  } else {
      [tA.proId, tA.youthId].forEach(pid => { goalsA += parseInt(document.getElementById(`g-${pid}`).value)||0; });
      [tB.proId, tB.youthId].forEach(pid => { goalsB += parseInt(document.getElementById(`g-${pid}`).value)||0; });
  }

  // 🛑 ANTI-DRAW KNOCKOUT SHIELD
  if (goalsA === goalsB && t.phase === 'elimination') {
      showErr('rec-err', 'Knockout matches cannot end in a draw! Play penalties and add 1 goal to the winner.');
      return;
  }

  // 🛑 SANITY CHECK — catch obvious typos before they get saved
  const highestSingleScore = Math.max(goalsA, goalsB);
  if(highestSingleScore >= 15){
      if(!confirm(`⚠️ ${highestSingleScore} goals in one match is unusually high — double-check the number.\n\nSave it anyway?`)) return;
  }

  // 🛑 قفل الزر لمنع الضغط المزدوج
  const btn = document.querySelector('#modal-record .btn-green');
  if(btn) { btn.innerHTML = '⏳ SAVING...'; btn.style.pointerEvents = 'none'; }

  let matchEvents = { goals: {}, cards: {} };
  if(t.type === '1v1') {
      matchEvents.goals[aId] = goalsA; matchEvents.goals[bId] = goalsB;
      if(document.getElementById(`y-${aId}`)?.checked) matchEvents.cards[aId] = 'yellow';
      if(document.getElementById(`r-${aId}`)?.checked) matchEvents.cards[aId] = 'red';
      if(document.getElementById(`y-${bId}`)?.checked) matchEvents.cards[bId] = 'yellow';
      if(document.getElementById(`r-${bId}`)?.checked) matchEvents.cards[bId] = 'red';
  } else {
      [tA.proId, tA.youthId].forEach(pid => {
          let g = parseInt(document.getElementById(`g-${pid}`).value)||0;
          matchEvents.goals[pid] = g;
          if(document.getElementById(`y-${pid}`)?.checked) matchEvents.cards[pid] = 'yellow';
          if(document.getElementById(`r-${pid}`)?.checked) matchEvents.cards[pid] = 'red';
      });
      [tB.proId, tB.youthId].forEach(pid => {
          let g = parseInt(document.getElementById(`g-${pid}`).value)||0;
          matchEvents.goals[pid] = g;
          if(document.getElementById(`y-${pid}`)?.checked) matchEvents.cards[pid] = 'yellow';
          if(document.getElementById(`r-${pid}`)?.checked) matchEvents.cards[pid] = 'red';
      });
  }

  const matchRecord={
      teamA:tA.name, teamB:tB.name, aId, bId, goalsA, goalsB, 
      ts:Date.now(), votes:{}, motm:null, avgRatings:{}, events: matchEvents 
  };
  t.matches.push(matchRecord);

  tA.PL++;tB.PL++;
  tA.GF+=goalsA;tA.GA+=goalsB;tB.GF+=goalsB;tB.GA+=goalsA;
  tA.GD=tA.GF-tA.GA;tB.GD=tB.GF-tB.GA;
  if(goalsA>goalsB){tA.W++;tA.PTS+=3;tB.L++}
  else if(goalsB>goalsA){tB.W++;tB.PTS+=3;tA.L++}
  else{tA.D++;tA.PTS++;tB.D++;tB.PTS++}

  if(t.schedule){
    const schedIdx=t.schedule.findIndex(m=>!m.played&&((m.aId===aId&&m.bId===bId)||(m.aId===bId&&m.bId===aId)));
    if(schedIdx>=0)t.schedule[schedIdx].played=true;
  }
  if(t.bracket) updateBracket(t,aId,bId,goalsA,goalsB);

  const matchResults={};
  Object.keys(matchEvents.goals).forEach(pid => {
      let g = matchEvents.goals[pid]; let card = matchEvents.cards[pid];
      let matchResult = 'draw';
      let isTeamA = (t.type === '1v1' ? pid === aId : (pid === tA.proId || pid === tA.youthId));
      let isTeamB = (t.type === '1v1' ? pid === bId : (pid === tB.proId || pid === tB.youthId));
      if(isTeamA && goalsA > goalsB) matchResult = 'win';
      else if(isTeamA && goalsA < goalsB) matchResult = 'loss';
      else if(isTeamB && goalsB > goalsA) matchResult = 'win';
      else if(isTeamB && goalsB < goalsA) matchResult = 'loss';
      matchResults[pid]=matchResult;

      updatePlayerMarketValue(db, pid, { result: matchResult, goals: g, card: card }, isRewardTournament(t));
      const p = db.players.find(x => x.id === pid);
      if(p){
          p.stats.matchesPlayed=(p.stats.matchesPlayed||0)+1;
          if(matchResult==='win')p.stats.winStreak=(p.stats.winStreak||0)+1;
          else{ p.stats.winStreak=0; if(matchResult==='loss')p.stats.totalLosses=(p.stats.totalLosses||0)+1; }
      }
      if(g > 0 && card !== 'red') { 
          if(p) { p.stats.goals = (p.stats.goals || 0) + g; awardXP(db, pid, g * 10); }
      }
  });

  let teamA_Ids = t.type === '1v1' ? [aId] : [tA.proId, tA.youthId];
  let teamB_Ids = t.type === '1v1' ? [bId] : [tB.proId, tB.youthId];
  let resultA = goalsA > goalsB ? 1 : (goalsA < goalsB ? 0 : 0.5);
  
  updateELO(db, teamA_Ids, teamB_Ids, resultA);
  teamA_Ids.forEach(id => awardXP(db, id, goalsA > goalsB ? 30 : (goalsA === goalsB ? 10 : 5)));
  teamB_Ids.forEach(id => awardXP(db, id, goalsB > goalsA ? 30 : (goalsA === goalsB ? 10 : 5)));

  Object.keys(matchEvents.cards).forEach(pid => {
      const cardType = matchEvents.cards[pid]; const p = db.players.find(x => x.id === pid);
      if(!p) return;
      if(cardType === 'yellow') p.stats.yellow = (p.stats.yellow || 0) + 1;
      else if (cardType === 'red') {
          p.stats.red = (p.stats.red || 0) + 1; p.stats.points = (p.stats.points || 0) - 1; 
          let entry = (t.type === '1v1') 
              ? t.standings.find(s => s.id === pid) 
              : t.standings.find(s => s.proId === pid || s.youthId === pid);
          if(entry) {
              entry.reds = entry.reds || {}; entry.reds[pid] = (entry.reds[pid] || 0) + 1;
              if(entry.reds[pid] > 3) {
                  if(t.format === 'league') { entry.PTS -= 4; addNews(`🚨 PENALTY: ${p.name} exceeded 3 red cards. Team loses 4 Points!`,'🚨'); }
                  p.status = 'suspended'; 
              }
          }
      }
  });

  const goalDiff = Math.abs(goalsA - goalsB);
  const headline = buildMatchHeadline(goalsA,goalsB,tA.name,tB.name,goalDiff);
  addNews(headline, '📰');
  checkAchievements(db, matchEvents, matchResults);
  
  // 🛡️ حزام الأمان (Try/Catch) لمنع تجمد الزر
  try {
      await saveSingleTournament(t);
      if(t.type === '1v1') {
          await saveSinglePlayer(db.players.find(x => x.id === aId)); await saveSinglePlayer(db.players.find(x => x.id === bId));
      } else {
          await saveSinglePlayer(db.players.find(x => x.id === tA.proId)); await saveSinglePlayer(db.players.find(x => x.id === tA.youthId));
          await saveSinglePlayer(db.players.find(x => x.id === tB.proId)); await saveSinglePlayer(db.players.find(x => x.id === tB.youthId));
      }
      localStorage.setItem(DB_KEY, JSON.stringify(db));

      if(t.phase==='groups'&&t.autoQualify&&t.schedule&&t.schedule.length>0&&t.schedule.every(m=>m.played)){
          await qualifyGroupsToKnockout(db,t);
      }

      closeModal('modal-record');
      renderTournamentScreen();
      showGoalAnimation(`${goalsA} – ${goalsB}`);
      snack(`⚽ ${tA.name} ${goalsA}–${goalsB} ${tB.name}`);
  } catch(err) {
      console.error(err);
      showErr('rec-err', '❌ Network Error. Match not saved.');
  } finally {
      // 🔓 فك تجميد الزر دائماً مهما حدث
      if(btn) { btn.innerHTML = '✅ SAVE RESULT'; btn.style.pointerEvents = 'auto'; }
  }
}

function updateBracket(t,aId,bId,goalsA,goalsB){
  if(!t.bracket)return;
  for(let r=0;r<t.bracket.length;r++){
    for(let m=0;m<t.bracket[r].length;m++){
      const match=t.bracket[r][m];
      if((match.p1===aId&&match.p2===bId)||(match.p1===bId&&match.p2===aId)){
        if(match.winner)return;
        match.score1=match.p1===aId?goalsA:goalsB;
        match.score2=match.p1===aId?goalsB:goalsA;
        match.winner=goalsA>goalsB?aId:goalsB>goalsA?bId:null;
        if(match.winner&&r+1<t.bracket.length){
          const nextMatchIdx=Math.floor(m/2);
          const nextMatch=t.bracket[r+1][nextMatchIdx];
          if(!nextMatch)return;
          if(m%2===0)nextMatch.p1=match.winner;
          else nextMatch.p2=match.winner;
        }
        return;
      }
    }
  }
}

function awardXP(db,pid,xp){
  const p=db.players.find(x=>x.id===pid);if(!p)return;
  p.stats=p.stats||{xp:0,points:0,trophies:0,goals:0};
  p.stats.xp=Math.max(0,(p.stats.xp||0)+xp);
}

// ============================================================
// MOTM VOTING
// ============================================================
// ============================================================
// THE REALISTIC VOTING SYSTEM (Hides Red Cards + 2v2 Support)
// ============================================================
function openMotmVote(matchIdx){
  const t=getTournament();if(!t)return;
  const match=t.matches[matchIdx];if(!match)return;
  if(!currentUser){snack('Login to vote!');return}
  const hasVoted=match.votes&&match.votes[currentUser.id];
  motmMatchIdx=matchIdx;
  motmVotes={motm:null,ratings:{}};
  const db=getDB();
  
  let pids = [];
  if(t.type === '1v1') pids = [match.aId, match.bId];
  else {
      const tA = t.standings.find(s=>s.id === match.aId);
      const tB = t.standings.find(s=>s.id === match.bId);
      if(tA) pids.push(tA.proId, tA.youthId);
      if(tB) pids.push(tB.proId, tB.youthId);
  }
  
  const validPids = pids.filter(id => !match.events || !match.events.cards || match.events.cards[id] !== 'red');
  const players = validPids.map(id => db.players.find(x=>x.id===id)||{id,name:id});

  let resultsHtml='';
  if(hasVoted||t.status==='ended'){
    const allVotes=Object.values(match.votes||{});
    const motmCounts={};
    players.forEach(p=>{
      const votes=allVotes.filter(v=>v.motm===p.id);
      motmCounts[p.id]=votes.length;
      const avgRating=votes.length?Math.round(votes.reduce((s,v)=>s+(v.ratings[p.id]||3),0)/votes.length*10)/10:0;
      resultsHtml+=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="flex:1;font-size:13px;font-weight:600">${p.name}</span>
        <span style="color:var(--gold);font-size:12px">⭐ ${avgRating}/5</span>
        <span style="color:var(--sub);font-size:11px">${motmCounts[p.id]||0} MOTM votes</span>
      </div>`;
    });
    const motmWinner=Object.entries(motmCounts).sort((a,b)=>b[1]-a[1])[0];
    const winnerName=motmWinner?db.players.find(x=>x.id===motmWinner[0])?.name||motmWinner[0]:'N/A';
    document.getElementById('motm-body').innerHTML=`
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:11px;color:var(--gold);letter-spacing:2px;font-weight:700;margin-bottom:6px">MATCH: ${match.teamA} ${match.goalsA}–${match.goalsB} ${match.teamB}</div>
        ${hasVoted?`<div style="font-size:12px;color:var(--green);font-weight:600">✅ You already voted</div>`:''}
      </div>
      <div style="background:var(--card);border-radius:12px;padding:14px;margin-bottom:12px">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--sub);margin-bottom:10px">CURRENT RESULTS</div>
        ${resultsHtml}
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--gold);font-weight:700">🏅 Man of the Match: ${winnerName}</div>
      </div>
      <button class="btn btn-ghost" onclick="closeModal('modal-motm')">Close</button>`;
    document.getElementById('modal-motm').classList.add('active');
    return;
  }

  let votingHtml=`<div style="text-align:center;margin-bottom:16px;font-size:14px;font-weight:600">${match.teamA} <span style="color:var(--gold)">${match.goalsA}–${match.goalsB}</span> ${match.teamB}</div>`;
  if(players.length === 0) votingHtml += `<div style="font-size:12px; color:var(--red); text-align:center">All players received Red Cards. No MOTM possible.</div>`;
  players.forEach(p=>{
    const isMe = (currentUser.id === p.id);
    votingHtml+=`<div class="motm-section" style="${isMe ? 'opacity:0.4; pointer-events:none' : ''}">
      <div class="motm-title">${isMe ? 'Fair Play: Cannot vote for yourself' : 'Rate: ' + p.name}</div>
      <div class="motm-player-row">
        <div class="motm-name">${p.name}</div>
        <div class="motm-stars">
          ${[1,2,3,4,5].map(n=>`<button class="motm-star-btn" data-player="${p.id}" data-star="${n}" onclick="setMotmStar('${p.id}',${n})">⭐</button>`).join('')}
        </div>
      </div>
      <button class="motm-pick-btn" data-motm="${p.id}" onclick="setMotmPick('${p.id}','${encodeURIComponent(p.name)}')">🏅 Vote as MOTM</button>
    </div>`;
  });
  document.getElementById('motm-body').innerHTML=votingHtml;
  document.getElementById('modal-motm').classList.add('active');
}

function setMotmStar(pid,stars){
  motmVotes.ratings[pid]=stars;
  document.querySelectorAll(`.motm-star-btn[data-player="${pid}"]`).forEach(btn=>{
    btn.classList.toggle('lit',parseInt(btn.dataset.star)<=stars);
  });
}
function setMotmPick(pid,encodedName){
  motmVotes.motm=pid;
  document.querySelectorAll('.motm-pick-btn').forEach(btn=>{
    btn.classList.toggle('picked',btn.dataset.motm===pid);
  });
  snack(`🏅 Voted for ${decodeURIComponent(encodedName)} as MOTM`);
}

// ============================================================
// THE SECURE MOTM VOTE (Exploit Fix + Tournament Lock)
// ============================================================
// ============================================================
// THE SECURE MOTM VOTE (Exploit Fix + Button Lock)
// ============================================================
async function submitMotmVote(){
  if(!currentUser){snack('Login to vote!');return}
  if(!motmVotes.motm){showErr('motm-err','Pick a Man of the Match!');return}
  const db=getDB();
  const t=getTournament();
  if(!t){closeModal('modal-motm');return}
  const match=t.matches[motmMatchIdx];
  if(!match){closeModal('modal-motm');return}
  
  if(t.status === 'ended') {
      showErr('motm-err', 'Voting is permanently locked. The Cup has ended!');
      return;
  }

  // 🛑 قفل الزر لمنع الضغط المزدوج
  const btn = document.querySelector('#modal-motm .btn-gold');
  if(btn) { btn.innerHTML = '⏳ SAVING...'; btn.style.pointerEvents = 'none'; }

  match.votes=match.votes||{};
  match.votes[currentUser.id]={motm:motmVotes.motm,ratings:motmVotes.ratings};
  const allVotes=Object.values(match.votes);
  
  let pids = [];
  if(t.type === '1v1') pids = [match.aId, match.bId];
  else {
      const tA = t.standings.find(s=>s.id === match.aId);
      const tB = t.standings.find(s=>s.id === match.bId);
      if(tA) pids.push(tA.proId, tA.youthId);
      if(tB) pids.push(tB.proId, tB.youthId);
  }

  const motmCounts={};
  pids.forEach(pid=>{
    if(match.events && match.events.cards && match.events.cards[pid] === 'red') return; 
    const vs=allVotes.filter(v=>v.motm===pid);
    if(vs.length > 0) motmCounts[pid]=vs.length;
    const avg=vs.length?Math.round(vs.reduce((s,v)=>s+(v.ratings[pid]||3),0)/vs.length*10)/10:0;
    match.avgRatings=match.avgRatings||{};
    match.avgRatings[pid]=avg;
  });
  
  const winner=Object.entries(motmCounts).sort((a,b)=>b[1]-a[1])[0];
  const prevMotmName=match.motm;
  let playersToSave = [];

  if(winner){
    const winnerPlayer = db.players.find(x=>x.id===winner[0]);
    const winnerName = winnerPlayer ? winnerPlayer.name : winner[0];
    
    if(prevMotmName !== winnerName){
      if(prevMotmName) {
          const oldWinner = db.players.find(x=>x.name===prevMotmName);
          if(oldWinner) {
              oldWinner.stats.xp = Math.max(0, (oldWinner.stats.xp || 0) - 30);
              if(isRewardTournament(t))oldWinner.marketValue = Math.max(100000, (oldWinner.marketValue || 500000) - 200000);
              playersToSave.push(oldWinner);
          }
      }
      match.motm = winnerName; awardXP(db,winner[0],30); if(isRewardTournament(t))awardMotmValue(db,winner[0]);
      if(winnerPlayer) playersToSave.push(winnerPlayer);
      addNews(`🏅 ${winnerName} won Man of the Match!`,'⭐');
    }
  }
  
  await saveSingleTournament(t);
  for(let p of playersToSave) { await saveSinglePlayer(p); }
  localStorage.setItem(DB_KEY, JSON.stringify(db));

  if(btn) { btn.innerHTML = '✅ SUBMIT RATINGS'; btn.style.pointerEvents = 'auto'; }
  closeModal('modal-motm'); renderTournamentScreen(); snack('✅ Vote submitted!');
}

// ============================================================
// END CUP
// ============================================================
function confirmEnd(){
  const db=getDB();
  const t=db.tournaments[activeTournIdx];
  if(!t)return;
  if(t.matches.length===0){snack('⚠️ Record at least one match first!');return;}
  if(t.phase==='elimination'&&t.bracket&&t.bracket.length>0){
    const finalMatch=t.bracket[t.bracket.length-1][0];
    if(!finalMatch.winner){snack('⚠️ The Final Match is not played yet!');return;}
  }

  const goalCounts={};
  t.matches.forEach(m=>{if(m.events&&m.events.goals){Object.keys(m.events.goals).forEach(pid=>{goalCounts[pid]=(goalCounts[pid]||0)+m.events.goals[pid];});}});
  let topScorerIds=[];let maxGoals=0;
  Object.keys(goalCounts).forEach(pid=>{if(goalCounts[pid]>maxGoals){maxGoals=goalCounts[pid];topScorerIds=[pid];}else if(goalCounts[pid]===maxGoals&&maxGoals>0){topScorerIds.push(pid);}});

  let winner;
  if(t.phase==='elimination'&&t.bracket&&t.bracket.length>0){
    const finalMatch=t.bracket[t.bracket.length-1][0];
    winner=t.standings.find(s=>s.id===finalMatch.winner);
  } else {
    winner=sortedStandings(t)[0];
  }
  const bootNames=topScorerIds.map(pid=>{const p=db.players.find(x=>x.id===pid);return p?p.name:'';}).filter(Boolean);

  const txt=document.querySelector('#conf-ov .conf-txt');
  if(txt){
    if(isRewardTournament(t)){
      const mvpPreview=computeTournamentMVP(t,db);
      const mvpName=mvpPreview?(db.players.find(x=>x.id===mvpPreview.pid)?.name||''):'';
      txt.innerHTML=`🏆 Champion: <strong style="color:var(--gold)">${winner?winner.name:'—'}</strong>${bootNames.length?`<br>🥾 Golden Boot: <strong style="color:var(--gold)">${bootNames.join(' & ')}</strong> (${maxGoals} goals)`:''}${mvpName?`<br>🏅 Tournament MVP: <strong style="color:var(--gold)">${mvpName}</strong> (Score: ${mvpPreview.score})`:''}<br><br>Points, goals & XP are permanently saved. The cup is locked forever.`;
    } else {
      const catLabel=t.category==='friendly'?'🤝 Friendly':'🎯 Qualifier';
      txt.innerHTML=`${catLabel} winner: <strong style="color:var(--gold)">${winner?winner.name:'—'}</strong><br><br>No cup, no golden boot, no market value change — but XP, ELO, goals, cards and points are permanently saved to history.`;
    }
  }
  document.getElementById('conf-ov').classList.add('active');
}
// ============================================================
// END CUP (FIXED TRUE CHAMPION LOGIC)
// ============================================================
// ============================================================
// END CUP (ANTI-SPAM & SAFE SAVE FIX)
// ============================================================
async function endCup(){
  const db=getDB();
  const t=db.tournaments[activeTournIdx];
  if(!t) { closeConf(); return; }
  
  // 🛑 الحماية من التكرار (منع ثغرة الجوائز اللانهائية)
  if(t.status === 'ended') { closeConf(); snack('⚠️ Cup is already ended!'); return; }
  if(t.matches.length===0){closeConf();snack('⚠️ Record at least one match first!');return}
  
  const btn = document.querySelector('.conf-btns .btn-red');
  if(btn) { btn.innerHTML = '⏳ SAVING...'; btn.style.pointerEvents = 'none'; }
  
  const goalCounts={};
  t.matches.forEach(m=>{if(m.events&&m.events.goals){Object.keys(m.events.goals).forEach(pid=>{goalCounts[pid]=(goalCounts[pid]||0)+m.events.goals[pid];});}});
  let topScorerIds=[];let maxGoals=0;
  Object.keys(goalCounts).forEach(pid=>{if(goalCounts[pid]>maxGoals){maxGoals=goalCounts[pid];topScorerIds=[pid];}else if(goalCounts[pid]===maxGoals&&maxGoals>0){topScorerIds.push(pid);}});
  
  let winner;
  if(t.phase === 'elimination' && t.bracket && t.bracket.length > 0) {
      const finalMatch = t.bracket[t.bracket.length - 1][0];
      if(!finalMatch.winner) {
          closeConf(); snack('⚠️ The Final Match is not played yet!'); 
          if(btn) { btn.innerHTML = 'End Cup'; btn.style.pointerEvents = 'auto'; }
          return;
      }
      winner = t.standings.find(s => s.id === finalMatch.winner);
  } else {
      winner = sortedStandings(t)[0];
  }
  if(!winner) { closeConf(); snack('⚠️ Could not determine a winner!'); if(btn){btn.innerHTML='End Cup';btn.style.pointerEvents='auto';} return; }

  t.standings.forEach(entry=>{
    const pids=t.type==='1v1'?[entry.id]:[entry.proId,entry.youthId].filter(Boolean);
    pids.forEach(pid=>{const p=db.players.find(x=>x.id===pid);if(!p)return;p.stats=p.stats||{xp:0,points:0,trophies:0,goals:0,elo:1000,goldenBoots:0};p.stats.points=(p.stats.points||0)+entry.PTS;});
  });
  
  const winPids=t.type==='1v1'?[winner.id]:[winner.proId,winner.youthId].filter(Boolean);
  const rewardTournament=isRewardTournament(t);
  winPids.forEach(pid=>{const p=db.players.find(x=>x.id===pid);if(!p)return;awardXP(db,pid,200);if(rewardTournament){p.stats.trophies=(p.stats.trophies||0)+1;p.previousMarketValue=p.marketValue||500000;p.marketValue=(p.marketValue||500000)+500000;recordMarketValueHistory(p);}});

  // 💎 Perfect Cup — champion went the entire tournament without a single loss.
  // Tied to actually being crowned champion, so Official tournaments only.
  if(rewardTournament&&(winner.L||0)===0){
    winPids.forEach(pid=>{
      const p=db.players.find(x=>x.id===pid);if(!p)return;
      p.stats.badges=p.stats.badges||[];
      if(!p.stats.badges.includes('💎 Perfect Cup (Unbeaten Champion)')){
        p.stats.badges.push('💎 Perfect Cup (Unbeaten Champion)');
        addNews(`💎 PERFECT CUP: ${p.name} won "${t.name}" without a single loss!`,'💎');
      }
    });
  }
  
  let bootNames=[];
  topScorerIds.forEach(pid=>{const p=db.players.find(x=>x.id===pid);if(p){awardXP(db,pid,100);if(rewardTournament){p.stats.goldenBoots=(p.stats.goldenBoots||0)+1;p.previousMarketValue=p.marketValue||500000;p.marketValue=(p.marketValue||500000)+300000;recordMarketValueHistory(p);}bootNames.push(p.name);}});

  // 🏅 Tournament MVP — Official tournaments only, min. 3 matches played,
  // score = goals×3 + wins×2 + MOTM×5, ties broken by most goals.
  let mvpAward=null;
  if(rewardTournament){
    const mvp=computeTournamentMVP(t,db);
    if(mvp){
      const mp=db.players.find(x=>x.id===mvp.pid);
      if(mp){
        awardXP(db,mvp.pid,150);
        mp.stats.tournamentMVPs=(mp.stats.tournamentMVPs||0)+1;
        mp.previousMarketValue=mp.marketValue||500000;
        mp.marketValue=(mp.marketValue||500000)+200000;
        recordMarketValueHistory(mp);
        mvpAward={name:mp.name,score:mvp.score};
      }
    }
  }
  
  t.status='ended';
  if(rewardTournament){
    addNews(`🏆 "${t.name}" ended! Winner: ${winner.name}! 🎉`,'🏆');
    if(bootNames.length>0)addNews(`🥾 GOLDEN BOOT: ${bootNames.join(' & ')} (${maxGoals} Goals)`,'🥾');
    if(mvpAward)addNews(`🏅 TOURNAMENT MVP: ${mvpAward.name} named MVP of "${t.name}" (Score: ${mvpAward.score})!`,'🏅');
  } else {
    const catLabel=t.category==='friendly'?'🤝 Friendly':'🎯 Qualifier';
    addNews(`${catLabel} "${t.name}" ended! ${winner.name} came out on top (no cup awarded).`,t.category==='friendly'?'🤝':'🎯');
  }
  
  // رفع البيانات للسيرفر بأمان تام
  await saveSingleTournament(t);
  const playersToSave = new Set();
  t.standings.forEach(entry => {
      if(t.type === '1v1') Object.keys(entry).includes('id') && playersToSave.add(entry.id);
      else { if(entry.proId) playersToSave.add(entry.proId); if(entry.youthId) playersToSave.add(entry.youthId); }
  });
  for(let pid of Array.from(playersToSave)) {
      const p = db.players.find(x => x.id === pid);
      if(p) await saveSinglePlayer(p);
  }
  localStorage.setItem(DB_KEY, JSON.stringify(db));

  if(btn) { btn.innerHTML = 'End Cup'; btn.style.pointerEvents = 'auto'; }
  closeConf();renderTournamentScreen();showGoalAnimation('🏆 CHAMPION!');snack(`🏆 ${winner.name} wins the cup!`);setTimeout(()=>showWinnerCelebration(winner,t,db),1200);
}

// ============================================================
// ARCHIVE TOURNAMENT (ADMIN ONLY)
// ============================================================
async function toggleArchiveTournament(){
  if(currentUser?.type!=='admin')return;
  const db=getDB();
  const t=db.tournaments[activeTournIdx];
  if(!t)return;
  t.archivedAt=t.archivedAt?null:Date.now();
  await saveSingleTournament(t);
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack(t.archivedAt?`📦 "${t.name}" archived.`:`✅ "${t.name}" restored from archive.`);
  renderTournamentScreen();
}

// ============================================================
// DELETE TOURNAMENT (ADMIN ONLY)
// ============================================================
async function deleteTournament(){
  if(currentUser?.type !== 'admin') return;
  const db = getDB();
  const t = db.tournaments[activeTournIdx];
  if(!t) return;
  
  const confirmText = prompt(`⚠️ DANGER: Type "DELETE" to permanently remove "${t.name}".\nThis will ALSO reverse every goal, card, XP, market-value, trophy and golden-boot change it caused for every player involved. This cannot be undone!`);
  if(confirmText !== "DELETE") { snack("❌ Deletion canceled."); return; }

  try {
      // 1. Reverse every match's effect on player stats (goals, cards, XP, market value)
      (t.matches||[]).forEach(m=>revertMatchEffects(db,t,m));
      // 2. Reverse trophy / golden-boot / career-points effects if the cup had already ended
      revertTournamentEndEffects(db,t);

      // 3. Persist every affected player back to the cloud
      const affected=new Set();
      (t.participants||[]).forEach(p=>{
        if(t.type==='1v1') affected.add(p);
        else { if(p.proId)affected.add(p.proId); if(p.youthId)affected.add(p.youthId); }
      });
      for(const pid of affected){
        const p=db.players.find(x=>x.id===pid);
        if(p) await saveSinglePlayer(p);
      }

      // 4. Delete from Supabase Server
      await supabaseClient.from('tournaments').delete().eq('id', t.id);
      
      // 5. Delete from Local UI
      db.tournaments.splice(activeTournIdx, 1);
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      
      snack(`🗑️ "${t.name}" deleted — all player progress from it has been reversed.`);
      backToApp(); // Return to main arena
  } catch(err) {
      console.error(err);
      snack("❌ Error deleting tournament from server.");
  }
}

// ============================================================
// REVERSE ENGINE — undoes everything a tournament's matches/end
// awarded to players, so DELETE truly wipes all related progress.
// (Note: ELO rating is a running relative score shared across every
// tournament a player has ever played — it is NOT reversible in
// isolation, so ELO is intentionally left untouched here.)
// ============================================================
function reversePlayerMarketValue(db,pid,matchData){
  const p=db.players.find(x=>x.id===pid);if(!p)return;
  let val=p.marketValue||500000;
  if(matchData.result==='win')val-=100000;
  else if(matchData.result==='draw')val-=25000;
  else if(matchData.result==='loss')val+=50000;
  if(matchData.goals>0)val-=(matchData.goals*50000);
  if(matchData.card==='yellow')val+=50000;
  else if(matchData.card==='red')val+=150000;
  if(val<100000)val=100000; // safety floor — same as the forward engine
  p.marketValue=val;
  recordMarketValueHistory(p);
}
function revertMatchEffects(db,t,m){
  const events=m.events||{goals:{},cards:{}};
  const tA=t.standings.find(s=>s.id===m.aId);
  const tB=t.standings.find(s=>s.id===m.bId);
  const goalsA=m.goalsA, goalsB=m.goalsB;
  const rewardTournament=isRewardTournament(t);

  Object.keys(events.goals||{}).forEach(pid=>{
    const g=events.goals[pid];
    const card=(events.cards||{})[pid];
    const isTeamA=t.type==='1v1'?pid===m.aId:(tA&&(pid===tA.proId||pid===tA.youthId));
    const isTeamB=t.type==='1v1'?pid===m.bId:(tB&&(pid===tB.proId||pid===tB.youthId));
    let matchResult='draw';
    if(isTeamA&&goalsA>goalsB)matchResult='win';else if(isTeamA&&goalsA<goalsB)matchResult='loss';
    else if(isTeamB&&goalsB>goalsA)matchResult='win';else if(isTeamB&&goalsB<goalsA)matchResult='loss';

    if(rewardTournament)reversePlayerMarketValue(db,pid,{result:matchResult,goals:g,card:card});
    const p=db.players.find(x=>x.id===pid);
    if(p){
      p.stats.matchesPlayed=Math.max(0,(p.stats.matchesPlayed||0)-1);
      if(matchResult==='loss')p.stats.totalLosses=Math.max(0,(p.stats.totalLosses||0)-1);
      // Note: winStreak is a running counter, not a history log — like ELO,
      // it's intentionally left alone here since it can't be cleanly un-wound.
    }
    if(g>0&&card!=='red'){
      if(p){p.stats.goals=Math.max(0,(p.stats.goals||0)-g);awardXP(db,pid,-(g*10));}
    }
  });

  const teamA_Ids=t.type==='1v1'?[m.aId]:(tA?[tA.proId,tA.youthId]:[]);
  const teamB_Ids=t.type==='1v1'?[m.bId]:(tB?[tB.proId,tB.youthId]:[]);
  teamA_Ids.forEach(id=>awardXP(db,id,-(goalsA>goalsB?30:(goalsA===goalsB?10:5))));
  teamB_Ids.forEach(id=>awardXP(db,id,-(goalsB>goalsA?30:(goalsA===goalsB?10:5))));

  Object.keys(events.cards||{}).forEach(pid=>{
    const cardType=events.cards[pid];
    const p=db.players.find(x=>x.id===pid);if(!p)return;
    if(cardType==='yellow')p.stats.yellow=Math.max(0,(p.stats.yellow||0)-1);
    else if(cardType==='red')p.stats.red=Math.max(0,(p.stats.red||0)-1);
    // Suspension flags & the team's -4 PTS penalty are left untouched — the
    // tournament (and its standings) is being deleted anyway, and a player's
    // suspended/active status is left for the admin to review manually.
  });
}
function revertTournamentEndEffects(db,t){
  if(t.status!=='ended')return;
  const goalCounts={};
  (t.matches||[]).forEach(m=>{if(m.events&&m.events.goals){Object.keys(m.events.goals).forEach(pid=>{goalCounts[pid]=(goalCounts[pid]||0)+m.events.goals[pid];});}});
  let topScorerIds=[];let maxGoals=0;
  Object.keys(goalCounts).forEach(pid=>{if(goalCounts[pid]>maxGoals){maxGoals=goalCounts[pid];topScorerIds=[pid];}else if(goalCounts[pid]===maxGoals&&maxGoals>0){topScorerIds.push(pid);}});

  let winner=null;
  if(t.phase==='elimination'&&t.bracket&&t.bracket.length>0){
    const finalMatch=t.bracket[t.bracket.length-1][0];
    if(finalMatch&&finalMatch.winner)winner=t.standings.find(s=>s.id===finalMatch.winner);
  } else {
    winner=sortedStandings(t)[0]||null;
  }

  (t.standings||[]).forEach(entry=>{
    const pids=t.type==='1v1'?[entry.id]:[entry.proId,entry.youthId].filter(Boolean);
    pids.forEach(pid=>{const p=db.players.find(x=>x.id===pid);if(!p)return;p.stats.points=(p.stats.points||0)-entry.PTS;});
  });

  if(winner){
    const winPids=t.type==='1v1'?[winner.id]:[winner.proId,winner.youthId].filter(Boolean);
    winPids.forEach(pid=>{const p=db.players.find(x=>x.id===pid);if(!p)return;awardXP(db,pid,-200);if(isRewardTournament(t)){p.stats.trophies=Math.max(0,(p.stats.trophies||0)-1);p.marketValue=Math.max(100000,(p.marketValue||500000)-500000);}});
  }
  topScorerIds.forEach(pid=>{const p=db.players.find(x=>x.id===pid);if(p){awardXP(db,pid,-100);if(isRewardTournament(t)){p.stats.goldenBoots=Math.max(0,(p.stats.goldenBoots||0)-1);p.marketValue=Math.max(100000,(p.marketValue||500000)-300000);}}});

  if(isRewardTournament(t)){
    const mvp=computeTournamentMVP(t,db);
    if(mvp){
      const mp=db.players.find(x=>x.id===mvp.pid);
      if(mp){
        awardXP(db,mvp.pid,-150);
        mp.stats.tournamentMVPs=Math.max(0,(mp.stats.tournamentMVPs||0)-1);
        mp.marketValue=Math.max(100000,(mp.marketValue||500000)-200000);
      }
    }
  }
}

// ============================================================
// EDIT LAST MATCH (ADMIN ONLY) — undo the most recent result so
// it can be re-entered correctly. Not available for knockout ties
// (bracket progression makes a safe undo far riskier there).
// ============================================================
async function editLastMatch(){
  if(currentUser?.type!=='admin')return;
  const db=getDB();
  const t=db.tournaments[activeTournIdx];
  if(!t)return;
  if(!t.matches||t.matches.length===0){snack('⚠️ No matches to edit yet.');return;}
  if(t.phase==='elimination'){snack('⚠️ Knockout matches can\'t be edited this way — delete the tournament if it truly needs a reset.');return;}

  const m=t.matches[t.matches.length-1];
  if(!confirm(`Undo the last result?\n\n${m.teamA} ${m.goalsA} - ${m.goalsB} ${m.teamB}\n\nAll goals/cards/XP/value it caused will be reversed, and you'll be able to re-enter it correctly.`))return;

  // 1. Reverse the global player-stat effects of this match
  revertMatchEffects(db,t,m);

  // 2. Reverse this match's effect on the tournament standings
  const tA=t.standings.find(s=>s.id===m.aId);
  const tB=t.standings.find(s=>s.id===m.bId);
  if(tA&&tB){
    tA.PL--;tB.PL--;
    tA.GF-=m.goalsA;tA.GA-=m.goalsB;tB.GF-=m.goalsB;tB.GA-=m.goalsA;
    tA.GD=tA.GF-tA.GA;tB.GD=tB.GF-tB.GA;
    if(m.goalsA>m.goalsB){tA.W--;tA.PTS-=3;tB.L--;}
    else if(m.goalsB>m.goalsA){tB.W--;tB.PTS-=3;tA.L--;}
    else{tA.D--;tA.PTS--;tB.D--;tB.PTS--;}

    Object.keys((m.events&&m.events.cards)||{}).forEach(pid=>{
      if(m.events.cards[pid]==='red'){
        const entry=(t.type==='1v1')?t.standings.find(s=>s.id===pid):t.standings.find(s=>s.proId===pid||s.youthId===pid);
        if(entry&&entry.reds&&entry.reds[pid]){
          const wasOverLimit=entry.reds[pid]>3;
          entry.reds[pid]--;
          if(wasOverLimit&&t.format==='league')entry.PTS+=4;
        }
      }
    });
  }

  // 3. Re-open the schedule slot so it shows up as "next match" again
  if(t.schedule){
    const schedIdx=t.schedule.map((s,i)=>({s,i})).reverse().find(({s})=>s.played&&((s.aId===m.aId&&s.bId===m.bId)||(s.aId===m.bId&&s.bId===m.aId)))?.i;
    if(schedIdx!==undefined)t.schedule[schedIdx].played=false;
  }

  // 4. Remove the match record
  t.matches.pop();

  // 5. Persist
  await saveSingleTournament(t);
  const affected=new Set();
  if(t.type==='1v1'){affected.add(m.aId);affected.add(m.bId);}
  else{if(tA){affected.add(tA.proId);affected.add(tA.youthId);}if(tB){affected.add(tB.proId);affected.add(tB.youthId);}}
  for(const pid of affected){const p=db.players.find(x=>x.id===pid);if(p)await saveSinglePlayer(p);}
  localStorage.setItem(DB_KEY, JSON.stringify(db));

  snack('↩️ Last match undone — re-enter the correct result whenever ready.');
  renderTournamentScreen();
}

function showWinnerCelebration(winner,t,db){
  haptic([30,60,30,60,80]);
  const p = (t.type === '1v1') ? db.players.find(x=>x.id===winner.id) : null;
  const avEl=document.getElementById('winner-avatar');
  if(p?.photo)avEl.innerHTML=`<img src="${p.photo}" style="width:100%;height:100%;object-fit:cover">`;
  else avEl.innerHTML=initials(winner.name);
  document.getElementById('winner-name').textContent=winner.name;
  document.getElementById('winner-cup-name').textContent=`🏆 ${t.name} Champion`;
  const conf=document.getElementById('winner-confetti');
  conf.innerHTML='';
  const colors=['#f0b429','#ffd166','#06d77b','#4dabf7','#ff4757','#a855f7'];
  for(let i=0;i<60;i++){
    const d=document.createElement('div');
    d.className='confetti-piece';
    d.style.cssText=`left:${Math.random()*100}%;background:${colors[i%colors.length]};animation:confettiFall ${1.5+Math.random()*2}s ${Math.random()*2}s linear forwards;width:${4+Math.random()*8}px;height:${4+Math.random()*8}px;border-radius:${Math.random()>0.5?'50%':'2px'}`;
    conf.appendChild(d);
  }
  document.getElementById('winner-overlay').classList.add('active');
}
function closeWinnerOverlay(){document.getElementById('winner-overlay').classList.remove('active')}

// ============================================================
// LOCKER ROOM
// ============================================================
function renderLocker(){
  const db=getDB();const isAdmin=currentUser?.type==='admin';
  const container=document.getElementById('locker-list-container');
  let html='';
  
  if(isAdmin){
    const pend=db.pending||[];
    html+=`<div class="req-box">
      <div class="req-box-title">📥 Pending Requests <span style="background:rgba(255,71,87,0.18);padding:1px 8px;border-radius:10px">${pend.length}</span></div>
      ${pend.length===0?'<div style="font-size:13px;color:var(--sub)">No pending requests.</div>'
        :pend.map((p,i)=>`<div class="req-item">
          <div class="pav" style="width:40px;height:40px;font-size:14px;flex-shrink:0">${p.photo?`<img src="${p.photo}" loading="lazy">`:initials(p.name)}</div>
          <div class="req-info"><div class="req-name">${p.name}</div><div class="req-sub">Waiting for approval</div></div>
          <button class="btn-ok" onclick="approvePlayer(${i})">APPROVE</button>
          <button class="btn-x" onclick="denyPlayer(${i})">✕</button>
        </div>`).join('')}
    </div>`;
  }

  // Helper to draw cards
  const createCard = (p, i, isMyDashboard) => {
      let opacityStyle = (p.status === 'archived') ? 'opacity: 0.4; filter: grayscale(1);' : '';
      let dashStyle = isMyDashboard ? 'border: 1px solid var(--gold); box-shadow: 0 0 20px rgba(240,180,41,0.15); background: linear-gradient(135deg, rgba(240,180,41,0.1), var(--card));' : '';
      const xp=p.stats?.xp||0;const lvl=getLevelFromXP(xp);const stars=p.stars||0;const tier=p.tier||'youth';
      const xpThisLevel=lvl>1?xpForLevel(lvl):0;const xpNextLevel=xpForLevel(lvl+1);
      const xpPct=lvl>=100?100:Math.round(((xp-xpThisLevel)/(xpNextLevel-xpThisLevel))*100);
      const starHTML=[1,2,3,4,5].map(n=>`<button class="star-b ${stars>=n?'lit':''}" onclick="${isAdmin?`setStar(${i},${n})`:'void(0)'}" ${isAdmin?'':'disabled'}>⭐</button>`).join('');
      
      return `<div class="player-card" style="${opacityStyle} ${dashStyle}">
        <div class="pav" style="cursor:pointer" onclick="openProfile(${i},${currentUser?.id===p.id})">${p.photo?`<img src="${p.photo}" loading="lazy">`:`${initials(p.name)}`}</div>
        <div class="p-info" style="cursor:pointer" onclick="openProfile(${i},${currentUser?.id===p.id})">
          <div class="p-name">${p.name} ${p.status === 'suspended' ? '<span style="background:var(--red); color:#fff; font-size:9px; padding:2px 6px; border-radius:4px; font-weight:bold; margin-left:5px">🟥 SUSPENDED</span>' : ''} <span class="lvl-badge">LVL ${lvl}</span><span class="tier-chip ${tier==='pro'?'tc-pro':'tc-youth'}">${tier==='pro'?'⭐ PRO':'🌱 YOUTH'}</span></div>
          <div class="p-id">${p.id}</div>
          <div class="star-row">${starHTML}</div>
          <div class="xp-bar-wrap"><div class="xp-bar" style="width:${xpPct}%"></div></div>
          <div style="font-size:10px;color:var(--sub);margin-top:3px;font-weight:600">${xp} XP</div>
        </div>
        ${isAdmin?`<button class="tier-toggle-btn" onclick="openAdminManagePlayer(${i})" style="color:var(--blue)">MANAGE</button>`:''}
      </div>`;
  };

  if(currentUser?.type === 'player'){
      const myIdx = db.players.findIndex(x => x.id === currentUser.id);
      if(myIdx >= 0){
          html += `<div class="sec-hdr"><div class="sec-ttl" style="color:var(--gold)">🌟 My Dashboard</div></div>`;
          html += `<div class="player-list" style="margin-bottom:18px">${createCard(db.players[myIdx], myIdx, true)}</div>`;
      }
  }

  const searchTerm=(document.getElementById('locker-search')?.value||'').trim().toLowerCase();
  const advRange=getAdvRange('locker');
  let shownCount=0;
  let rosterHtml='';
  db.players.forEach((p,i)=>{
      if(p.status === 'archived' && !isAdmin) return;
      if(p.status === 'banned') return;
      if(currentUser?.type === 'player' && p.id === currentUser.id) return; 
      if(searchTerm && !p.name.toLowerCase().includes(searchTerm)) return;
      if(lockerFilterTier==='pro' && p.tier!=='pro') return;
      if(lockerFilterTier==='youth' && p.tier!=='youth') return;
      if(lockerFilterTier==='suspended' && p.status!=='suspended') return;
      if(!passesAdvFilter(p,advRange)) return;
      rosterHtml += createCard(p, i, false);
      shownCount++;
  });

  html+=`<div class="sec-hdr"><div class="sec-ttl">👕 Official Roster</div><div style="font-size:12px;color:var(--sub)">${shownCount} player${shownCount===1?'':'s'}</div></div>`;
  html+=`<div class="player-list">`;
  html+= shownCount===0
    ? `<div class="empty-state"><div class="empty-ico">👕</div><div class="empty-txt">No players match your search/filter.</div></div>`
    : rosterHtml;
  html+='</div>';
  setHTMLIfChanged(container, html);
}

function getPlayerForm(pid,db){
  const matches=[];
  db.tournaments.forEach(t=>{
    (t.matches||[]).forEach(m=>{
      if(t.type === '1v1') {
          if(m.aId===pid||m.bId===pid) matches.push({m,isA:m.aId===pid,ts:m.ts});
      } else {
          // 2v2 Logic
          if(m.events && m.events.goals && m.events.goals[pid] !== undefined) {
              const tA = t.standings.find(s => s.id === m.aId);
              const isA = tA && (tA.proId === pid || tA.youthId === pid);
              matches.push({m, isA: !!isA, ts: m.ts});
          }
      }
    });
  });
  matches.sort((a,b)=>b.ts-a.ts);
  return matches.slice(0,5).map(({m,isA})=>{
    const myG=isA?m.goalsA:m.goalsB;const thG=isA?m.goalsB:m.goalsA;
    if(myG>thG)return`<div class="form-w">W</div>`;
    if(thG>myG)return`<div class="form-l">L</div>`;
    return`<div class="form-d">D</div>`;
  }).join('');
}

function getPlayerAvgRating(pid,db){
  let total=0,count=0;
  db.tournaments.forEach(t=>{
    (t.matches||[]).forEach(m=>{
      if(m.avgRatings&&m.avgRatings[pid]){
        total+=m.avgRatings[pid];count++;
      }
    });
  });
  if(!count)return null;
  return Math.round(total/count*10)/10;
}

// ============================================================
// ADMIN APPROVAL (TARGETED ASYNC QUERIES)
// ============================================================
async function approvePlayer(idx){
  const db=getDB();
  const req=db.pending[idx];
  if(!req) return;
  
  let id = req.username; 
  
  // 🔒 Anti-Duplicate Check
  if(db.players.some(x => x.id === id)) {
      snack('⚠️ Username already exists!');
      await supabaseClient.from('pending_requests').delete().eq('username', id);
      db.pending.splice(idx,1);
      renderLocker();
      return;
  }
  
  const startHistory=[{ts:Date.now(),value:500000}];
  const newPlayer = {
      player_id: id, name: req.name, pin: req.pin, photo: req.photo||'', 
      tier: 'youth', stars: 0, stats: {xp:0,points:0,trophies:0,goals:0}, 
      market_value: 500000, status: 'active', market_value_history: startHistory
  };

  try {
      // 1. Insert directly into players table
      const { error: insertErr } = await supabaseClient.from('players').insert([newPlayer]);
      if(insertErr) throw insertErr;

      // 2. Delete exactly one row from pending_requests
      await supabaseClient.from('pending_requests').delete().eq('username', id);

      // 3. Update Local UI safely
      db.players.push({id:id, name:req.name, pin:req.pin, photo:req.photo||'', tier:'youth', stars:0, stats:{xp:0,points:0,trophies:0,goals:0}, marketValue:500000, marketValueHistory:startHistory, status: 'active', bio:'', position:'', preferredFoot:'', age:null, jerseyNumber:null, favoriteTeam:''});
      db.pending.splice(idx,1);
      
      addNews(`✅ ${req.name} joined! Username: ${id}`,'👋');
      snack(`✅ Approved! Username: ${id}`);
      renderLocker();
  } catch (err) {
      console.error(err);
      snack('❌ Failed to approve player on server.');
  }
}

async function denyPlayer(idx){
  const db=getDB();
  const req=db.pending[idx];
  if(!req) return;

  try {
      // Target specific deletion
      await supabaseClient.from('pending_requests').delete().eq('username', req.username);
      
      const name = req.name;
      db.pending.splice(idx,1);
      snack(`Removed request from ${name}`);
      renderLocker();
  } catch (err) {
      console.error(err);
      snack('❌ Network Error.');
  }
}
async function setStar(playerIdx,stars){
  const db=getDB();db.players[playerIdx].stars=stars;
  await saveSinglePlayer(db.players[playerIdx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  renderLocker();
}
async function toggleTier(playerIdx){
  const db=getDB();const p=db.players[playerIdx];p.tier=p.tier==='pro'?'youth':'pro';
  await saveSinglePlayer(p); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack(`${p.name} is now ${p.tier==='pro'?'⭐ PRO':'🌱 YOUTH'}`);
  closeModal('modal-admin-player');
  renderLocker();
}

function openAdminManagePlayer(idx){
  const db=getDB();const p=db.players[idx];if(!p)return;
  const body=document.getElementById('admin-player-body');
  body.innerHTML=`
    <div style="text-align:center;margin-bottom:16px">
      <div class="pav" style="width:60px;height:60px;margin:0 auto 10px;font-size:20px">${p.photo?`<img src="${p.photo}" loading="lazy">`:`${initials(p.name)}`}</div>
      <div style="font-weight:700;font-size:16px">${p.name}</div>
      <div style="font-size:11px;color:var(--sub)">${p.id}</div>
    </div>
    <div class="settings-card">
      <div class="settings-title">✏️ Edit Name</div>
      <div class="field"><label>New Name</label><input id="manage-name" type="text" value="${p.name}"></div>
      <button class="btn btn-blue" onclick="adminUpdateName(${idx})">UPDATE NAME</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">🔑 Reset PIN</div>
      <div class="field"><label>New PIN</label><input id="manage-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <button class="btn btn-gold" onclick="adminUpdatePin(${idx})">RESET PIN</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">🖼️ Update Photo</div>
      <div class="photo-row">
        <div class="photo-preview" id="manage-photo-prev" onclick="document.getElementById('manage-photo-file').click()">${p.photo?`<img src="${p.photo}" loading="lazy">`:'📷'}</div>
        <div><div style="font-size:14px;font-weight:600">Tap to change</div></div>
      </div>
      <input type="file" id="manage-photo-file" accept="image/*" style="display:none" onchange="handlePhoto(this,'manage-photo-prev','manage-photo-data')">
      <input type="hidden" id="manage-photo-data">
      <button class="btn btn-green" onclick="adminUpdatePhoto(${idx})">UPDATE PHOTO</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">🔄 Player Tier</div>
      <div style="font-size:11px; color:var(--sub); margin-bottom:8px;">Current: ${p.tier==='pro'?'⭐ PRO':'🌱 YOUTH'}</div>
      <button class="btn btn-blue" onclick="toggleTier(${idx})">SWITCH TO ${p.tier==='pro'?'🌱 YOUTH':'⭐ PRO'}</button>
    </div>
    <div class="settings-card" style="border-color:rgba(255,71,87,0.3)">
      <div class="settings-title" style="color:var(--red)">📦 Archive Player</div>
      <div style="font-size:11px; color:var(--sub); margin-bottom:8px;">Archiving hides the player from the Locker Room but keeps their stats safe.</div>
      <button class="btn btn-gold" style="margin-bottom:10px" onclick="adminToggleArchive(${idx})">${p.status === 'archived' ? 'UN-ARCHIVE PLAYER' : 'ARCHIVE PLAYER'}</button>
      
      <div class="settings-title" style="color:var(--red); margin-top:15px; border-top:1px solid rgba(255,71,87,0.2); padding-top:10px">🚫 Danger Zone</div>
      ${p.status === 'suspended' ? `<button class="btn btn-blue" style="margin-bottom:10px" onclick="adminClearSuspension(${idx})">✅ CLEAR SUSPENSION</button>` : ''}
      <button class="btn btn-red" onclick="adminToggleBan(${idx})">${p.status === 'banned' ? 'RESTORE PLAYER' : 'BAN / REMOVE PLAYER'}</button>
    </div>`;
  document.getElementById('modal-admin-player').classList.add('active');
}

// ============================================================
// ADMIN CONTROLS (WITH FORCED CLOUD SAVE)
// ============================================================
async function adminToggleBan(idx) {
    const db=getDB();const p=db.players[idx];
    if(!p) return;
    if(p.status==='banned'){p.status='active';snack(`✅ ${p.name} is RESTORED.`);}
    else{p.status='banned';snack(`🚫 ${p.name} is BANNED.`);}
    await saveSinglePlayer(p); localStorage.setItem(DB_KEY,JSON.stringify(db));
    closeModal('modal-admin-player');renderLocker();
}
async function adminToggleArchive(idx) {
    const db=getDB();const p=db.players[idx];
    if(!p) return;
    if(p.status==='archived'){p.status='active';snack(`✅ ${p.name} is now ACTIVE.`);}
    else{p.status='archived';snack(`📦 ${p.name} is now ARCHIVED.`);}
    await saveSinglePlayer(p); localStorage.setItem(DB_KEY,JSON.stringify(db));
    closeModal('modal-admin-player');renderLocker();
}

// ============================================================
// ADMIN CONTROLS (SAFE ASYNC UPDATES)
// ============================================================
async function adminUpdateName(idx){
  const name=document.getElementById('manage-name').value.trim();
  if(!name){snack('Enter a name');return}
  const db=getDB();if(!db.players[idx])return;db.players[idx].name=name;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack(`✅ Name updated to ${name}`);closeModal('modal-admin-player');renderLocker();
}

async function adminUpdatePin(idx){
  const pin=document.getElementById('manage-pin').value.trim();
  if(!/^\d{4}$/.test(pin)){snack('PIN must be 4 digits');return}
  const db=getDB();if(!db.players[idx])return;db.players[idx].pin=pin;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack('✅ PIN updated');closeModal('modal-admin-player');renderLocker();
}

async function adminUpdatePhoto(idx){
  const photo=document.getElementById('manage-photo-data').value;
  if(!photo){snack('Select a photo first');return}
  const db=getDB();if(!db.players[idx])return;db.players[idx].photo=photo;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack('✅ Photo updated');closeModal('modal-admin-player');renderLocker();
}

// ============================================================
// MARKET VALUE SPARKLINE — lightweight inline SVG line chart,
// no external chart library needed.
// ============================================================
function renderMarketValueSparkline(history){
  const pts=(history||[]).slice(-15);
  if(pts.length<2){
    return `<div style="font-size:11px;color:var(--sub);padding:6px 0">Not enough history yet — the curve builds up as this player's value changes over time.</div>`;
  }
  const vals=pts.map(h=>h.value);
  const min=Math.min(...vals), max=Math.max(...vals);
  const range=(max-min)||1;
  const W=280,H=64,PAD=6;
  const stepX=pts.length>1?(W-PAD*2)/(pts.length-1):0;
  const coords=pts.map((h,i)=>{
    const x=PAD+i*stepX;
    const y=PAD+(1-(h.value-min)/range)*(H-PAD*2);
    return{x,y,value:h.value};
  });
  const linePts=coords.map(c=>`${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const areaPts=`${PAD.toFixed(1)},${(H-PAD).toFixed(1)} ${linePts} ${(W-PAD).toFixed(1)},${(H-PAD).toFixed(1)}`;
  const dots=coords.map((c,i)=>`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${i===coords.length-1?3.5:2}" fill="${i===coords.length-1?'var(--gold)':'#ffd166'}"/>`).join('');
  const fmt=v=>v>=1000000?`€${(v/1000000).toFixed(2)}M`:`€${(v/1000).toFixed(0)}K`;
  return `
    <svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">
      <polygon points="${areaPts}" fill="url(#mvGrad)" opacity="0.15"/>
      <polyline points="${linePts}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      <defs><linearGradient id="mvGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--gold)"/><stop offset="100%" stop-color="var(--gold)" stop-opacity="0"/>
      </linearGradient></defs>
    </svg>
    <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:var(--sub);font-weight:600">
      <span>${fmt(coords[0].value)}</span><span style="color:var(--gold)">${fmt(coords[coords.length-1].value)}</span>
    </div>`;
}

// ============================================================
// PLAYER PROFILE WITH PERFORMANCE GRAPH
// ============================================================
function openProfile(idx,canEdit=false){
  const db=getDB();const p=db.players[idx];if(!p)return;
  const xp=p.stats?.xp||0;const lvl=getLevelFromXP(xp);const lvlTitle=getLevelTitle(lvl);
  const xpThisLevel=lvl>1?xpForLevel(lvl):0;const xpNextLevel=xpForLevel(lvl+1);
  const xpPct=lvl>=100?100:Math.round(((xp-xpThisLevel)/(xpNextLevel-xpThisLevel))*100);
  const s=p.stats||{};
  const avgRating=getPlayerAvgRating(p.id,db);
  const formHTML=getPlayerForm(p.id,db);

  // --- ENGINE UPGRADE: Calculate Graph Data (now carries opponent/score/tournament too) ---
  const playerMatches = [];
  db.tournaments.forEach(t => {
      (t.matches || []).forEach(m => {
          if (t.type === '1v1') {
              if(m.aId === p.id || m.bId === p.id) {
                  const myGoals = m.aId === p.id ? m.goalsA : m.goalsB;
                  const oppGoals = m.aId === p.id ? m.goalsB : m.goalsA;
                  const oppName = m.aId === p.id ? m.teamB : m.teamA;
                  const result = myGoals>oppGoals?'W':(myGoals<oppGoals?'L':'D');
                  playerMatches.push({ goals: myGoals, ts: m.ts, result, oppName, myGoals, oppGoals, tName:t.name });
              }
          } else {
              // 2v2 check
              if(m.events && m.events.goals && m.events.goals[p.id] !== undefined) {
                  const tA=t.standings.find(s=>s.id===m.aId), tB=t.standings.find(s=>s.id===m.bId);
                  const onTeamA = tA && (tA.proId===p.id||tA.youthId===p.id);
                  const myGoals = m.events.goals[p.id];
                  const result = onTeamA
                    ? (m.goalsA>m.goalsB?'W':(m.goalsA<m.goalsB?'L':'D'))
                    : (m.goalsB>m.goalsA?'W':(m.goalsB<m.goalsA?'L':'D'));
                  const oppName = onTeamA ? m.teamB : m.teamA;
                  const myGoalsScore = onTeamA ? m.goalsA : m.goalsB;
                  const oppGoalsScore = onTeamA ? m.goalsB : m.goalsA;
                  playerMatches.push({ goals: myGoals, ts: m.ts, result, oppName, myGoals:myGoalsScore, oppGoals:oppGoalsScore, tName:t.name });
              }
          }
      });
  });
  const totalMatches=playerMatches.length;
  const wins=playerMatches.filter(m=>m.result==='W').length;
  const draws=playerMatches.filter(m=>m.result==='D').length;
  const losses=playerMatches.filter(m=>m.result==='L').length;
  const winRate=totalMatches?Math.round((wins/totalMatches)*100):0;
  const avgGoalsPerMatch=totalMatches?(playerMatches.reduce((sum,m)=>sum+m.goals,0)/totalMatches).toFixed(1):'0.0';
  
  // Sort oldest to newest, get the last 5 matches for the goals bar chart
  playerMatches.sort((a,b) => a.ts - b.ts);
  const last5 = playerMatches.slice(-5);
  
  // Find the highest goals scored to calculate the bar height percentages
  const maxGoals = Math.max(...last5.map(m => m.goals), 1); 
  
  let graphHtml = `<div class="graph-container">`;
  if(last5.length === 0) {
      graphHtml += `<div style="font-size:11px; color:var(--sub); padding-bottom:10px;">No matches played yet to draw a graph.</div>`;
  } else {
      last5.forEach((m, index) => {
          let heightPercentage = (m.goals / maxGoals) * 100;
          graphHtml += `
          <div class="graph-bar-wrap">
              <div class="graph-val">${m.goals}</div>
              <div class="graph-bar" style="height:${heightPercentage}%"></div>
              <div class="graph-lbl">M${index + 1}</div>
          </div>`;
      });
  }
  graphHtml += `</div>`;
  // ---------------------------------------------

  // --- LAST 20 MATCHES LIST (newest first) ---
  const last20 = [...playerMatches].reverse().slice(0,20);
  const last20Html = last20.length===0
    ? `<div style="font-size:12px;color:var(--sub);padding:10px 0;text-align:center">No matches recorded yet.</div>`
    : last20.map(m=>{
        const resColor = m.result==='W'?'var(--green)':m.result==='L'?'var(--red)':'var(--sub)';
        const resLabel = m.result==='W'?'WIN':m.result==='L'?'LOSS':'DRAW';
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
          <div style="width:5px;height:28px;border-radius:3px;background:${resColor};flex-shrink:0"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">vs ${m.oppName||'?'}</div>
            <div style="font-size:10px;color:var(--sub);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.tName||''} · ${timeAgo(m.ts)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:var(--gold)">${m.myGoals}–${m.oppGoals}</div>
            <div style="font-size:9px;font-weight:700;color:${resColor};letter-spacing:0.5px">${resLabel}</div>
          </div>
        </div>`;
      }).join('');

  // --- ALL TOURNAMENTS THIS PLAYER HAS PLAYED IN ---
  const playerTournaments = db.tournaments.filter(t=>{
    if(t.type==='1v1') return t.standings.some(s=>s.id===p.id);
    return t.standings.some(s=>s.proId===p.id||s.youthId===p.id);
  });
  const tournamentsHtml = playerTournaments.length===0
    ? `<div style="font-size:12px;color:var(--sub);padding:10px 0;text-align:center">Hasn't joined any tournament yet.</div>`
    : playerTournaments.map(t=>{
        const entry = t.type==='1v1' ? t.standings.find(s=>s.id===p.id) : t.standings.find(s=>s.proId===p.id||s.youthId===p.id);
        const statusBadge = t.archivedAt
          ? `<span style="font-size:9px;background:rgba(90,90,138,0.15);color:var(--sub);padding:2px 7px;border-radius:6px;font-weight:700">📦 ARCHIVED</span>`
          : t.status==='ended'
          ? `<span style="font-size:9px;background:rgba(90,90,138,0.15);color:var(--sub);padding:2px 7px;border-radius:6px;font-weight:700">ENDED</span>`
          : `<span style="font-size:9px;background:rgba(6,215,123,0.15);color:var(--green);padding:2px 7px;border-radius:6px;font-weight:700">● LIVE</span>`;
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.name}</div>
            <div style="font-size:10px;color:var(--sub);margin-top:2px">${entry?`${entry.W}W-${entry.D}D-${entry.L}L · ${entry.PTS} PTS`:''}</div>
          </div>
          ${statusBadge}
        </div>`;
      }).join('');

  const badgesHtml = (s.badges && s.badges.length > 0) 
      ? s.badges.map(b => `<div style="display:inline-block; background:rgba(240,180,41,0.1); border:1px solid var(--gold); border-radius:8px; padding:4px 8px; font-size:11px; margin:2px; font-weight:700; color:var(--gold)">${b}</div>`).join('') 
      : '<div style="font-size:11px; color:var(--sub)">No badges yet.</div>';

  const posLabel={GK:'🧤 GK',DF:'🛡️ DF',MF:'⚙️ MF',FW:'⚡ FW'}[p.position]||'';
  const clubInfoParts=[];
  if(posLabel)clubInfoParts.push(`<span>${posLabel}</span>`);
  if(p.preferredFoot)clubInfoParts.push(`<span>🦶 ${p.preferredFoot}</span>`);
  if(p.age)clubInfoParts.push(`<span>🎂 ${p.age}y</span>`);
  if(p.jerseyNumber!=null&&p.jerseyNumber!=='')clubInfoParts.push(`<span>#${p.jerseyNumber}</span>`);
  if(p.favoriteTeam)clubInfoParts.push(`<span>❤️ ${p.favoriteTeam}</span>`);
  const clubInfoHtml=clubInfoParts.length?`<div style="display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--sub);font-weight:600">${clubInfoParts.join('')}</div>`:'';
  const bioHtml=p.bio?`<div style="margin-top:12px;font-size:13px;color:rgba(240,240,250,0.75);line-height:1.6;font-style:italic;text-align:center;padding:0 10px">"${p.bio}"</div>`:'';

  document.getElementById('profile-content').innerHTML=`
    <div class="profile-header">
      <div class="profile-avatar">${p.photo?`<img src="${p.photo}" loading="lazy">`:`${initials(p.name)}`}</div>
      <div class="profile-name">${p.name}</div>
      <div class="profile-id">${p.id} · ${p.tier==='pro'?'⭐ PRO':'🌱 YOUTH'}</div>
      <div style="margin-top:6px;font-size:16px;color:var(--purple);font-weight:700;font-family:'Bebas Neue',sans-serif;letter-spacing:1px">🌐 ${s.elo || 1000} GLOBAL ELO</div>
      <div style="margin-top:10px"><span class="lvl-badge" style="font-size:13px;padding:4px 14px">LVL ${lvl} · ${lvlTitle}</span></div>
      <div style="margin:12px 0 0">
        <div class="xp-bar-wrap" style="height:6px"><div class="xp-bar" style="width:${xpPct}%"></div></div>
        <div style="font-size:11px;color:var(--sub);margin-top:5px;font-weight:600">${xp} XP · Next at ${xpNextLevel} XP</div>
      </div>
      <div style="display:flex;justify-content:center;gap:4px;margin-top:12px">${formHTML}</div>
      ${clubInfoHtml}
      ${bioHtml}
    </div>
    
    <div style="margin-top:14px; padding:14px; background:var(--card); border-radius:12px; border:1px solid var(--border); text-align:center">
      <div style="font-size:10px; font-weight:700; letter-spacing:1.5px; color:var(--sub); margin-bottom:8px">ACHIEVEMENTS</div>
      ${badgesHtml}
    </div>

    <div class="settings-card" style="margin-top:14px">
      <div class="settings-title" style="font-size:11px">📈 Advanced Stats</div>
      <div class="stat-grid" style="grid-template-columns: 1fr 1fr; gap:6px">
        <div class="stat-cell"><div class="stat-val" style="color:${winRate>=50?'var(--green)':'var(--sub)'}">${winRate}%</div><div class="stat-lbl">Win Rate (${totalMatches} played)</div></div>
        <div class="stat-cell"><div class="stat-val">${avgGoalsPerMatch}</div><div class="stat-lbl">Goals / Match</div></div>
      </div>
      <div style="display:flex;justify-content:space-around;margin-top:8px;font-size:12px;color:var(--sub)">
        <span style="color:var(--green);font-weight:700">${wins}W</span>
        <span style="font-weight:700">${draws}D</span>
        <span style="color:var(--red);font-weight:700">${losses}L</span>
        ${avgRating?`<span style="color:var(--gold);font-weight:700">⭐ ${avgRating.toFixed(1)} avg rating</span>`:''}
      </div>
    </div>

    <div class="stat-grid" style="grid-template-columns: 1fr 1fr 1fr 1fr; gap:6px; margin-top:14px">
      <div class="stat-cell" style="padding:10px 4px"><div class="stat-val" style="font-size:24px">${s.points||0}</div><div class="stat-lbl">Points</div></div>
      <div class="stat-cell" style="padding:10px 4px"><div class="stat-val" style="font-size:24px">${s.trophies||0}</div><div class="stat-lbl">Cups 🏆</div></div>
      <div class="stat-cell" style="padding:10px 4px"><div class="stat-val" style="font-size:24px">${s.goals||0}</div><div class="stat-lbl">Goals ⚽</div></div>
      <div class="stat-cell" style="padding:10px 4px; background:rgba(240,180,41,0.08); border-color:var(--gold)"><div class="stat-val" style="font-size:24px">${s.goldenBoots||0}</div><div class="stat-lbl" style="color:var(--gold)">Boots 🥾</div></div>
    </div>

    <div class="stat-grid" style="grid-template-columns: 1fr; margin-top:8px">
      <div class="stat-cell" style="padding:10px 4px; background:rgba(168,85,247,0.08); border-color:var(--purple); display:flex; align-items:center; justify-content:center; gap:10px">
        <div class="stat-val" style="font-size:24px;color:var(--purple)">${s.tournamentMVPs||0}</div>
        <div class="stat-lbl" style="color:var(--purple)">Tournament MVP Awards 🏅</div>
      </div>
    </div>

    <div class="stat-grid" style="margin-top:8px; grid-template-columns: 1fr 1fr;">
      <div class="stat-cell" style="background:rgba(240,180,41,0.05); border-color:rgba(240,180,41,0.2)">
        <div class="stat-val" style="color:var(--gold)">${s.yellow||0}</div><div class="stat-lbl">Yellows 🟨</div>
      </div>
      <div class="stat-cell" style="background:rgba(255,71,87,0.05); border-color:rgba(255,71,87,0.2)">
        <div class="stat-val" style="color:var(--red)">${s.red||0}</div><div class="stat-lbl">Reds 🟥</div>
      </div>
    </div>

    <div class="graph-card">
      <div class="graph-title">📊 Goals History (Last 5)</div>
      ${graphHtml}
    </div>

    <div style="margin-top:14px;padding:14px;background:var(--card);border-radius:12px;border:1px solid var(--border)">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--sub);margin-bottom:8px">MARKET VALUE</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--gold);margin-bottom:8px">€${((p.marketValue||500000)/1000000).toFixed(2)}M</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--sub);margin-bottom:6px">VALUE OVER TIME</div>
      ${renderMarketValueSparkline(p.marketValueHistory)}
    </div>

    <div class="settings-card" style="margin-top:14px">
      <div class="settings-title" style="font-size:11px">🏟️ Tournaments (${playerTournaments.length})</div>
      <div style="max-height:220px;overflow-y:auto">${tournamentsHtml}</div>
    </div>

    <div class="settings-card" style="margin-top:14px">
      <div class="settings-title" style="font-size:11px">📝 Last 20 Matches</div>
      <div style="max-height:320px;overflow-y:auto">${last20Html}</div>
    </div>

    <button class="btn btn-gold" style="margin-top:14px" onclick="shareCard(${idx})">🖼️ SHARE PLAYER CARD</button>
    ${canEdit?`<button class="btn btn-ghost" style="margin-top:10px" onclick="openEditSelfProfile(${idx})">✏️ Edit My Profile</button>`:''}`;
    
  document.getElementById('modal-profile').classList.add('active');
  
  // Small trick to trigger the animation of the bars growing
  setTimeout(() => {
      document.querySelectorAll('.graph-bar').forEach(bar => {
          let h = bar.style.height;
          bar.style.height = '0%';
          setTimeout(() => { bar.style.height = h; }, 50);
      });
  }, 10);
}

function openEditSelfProfile(idx){
  closeModal('modal-profile');
  const db=getDB();const p=db.players[idx];if(!p)return;
  const body=document.getElementById('edit-profile-body');
  body.innerHTML=`
    <div class="settings-card">
      <div class="settings-title">🖼️ Change Photo</div>
      <div class="photo-row">
        <div class="photo-preview" id="self-photo-prev" onclick="document.getElementById('self-photo-file').click()">${p.photo?`<img src="${p.photo}" loading="lazy">`:'📷'}</div>
        <div><div style="font-size:14px;font-weight:600">Tap to upload</div></div>
      </div>
      <input type="file" id="self-photo-file" accept="image/*" style="display:none" onchange="handlePhoto(this,'self-photo-prev','self-photo-data')">
      <input type="hidden" id="self-photo-data" value="${p.photo||''}">
      <button class="btn btn-green" style="margin-top:8px" onclick="selfUpdatePhoto(${idx})">UPDATE PHOTO</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">✏️ Change Name</div>
      <div class="field"><label>New Name</label><input id="self-name" type="text" value="${p.name}"></div>
      <button class="btn btn-blue" onclick="selfUpdateName(${idx})">UPDATE NAME</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">🔑 Change PIN</div>
      <div class="field"><label>Current PIN</label><input id="self-cur-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <div class="field"><label>New PIN</label><input id="self-new-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <button class="btn btn-gold" onclick="selfUpdatePin(${idx})">CHANGE PIN</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">⚽ Club Card Details</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <div style="flex:1"><label style="font-size:9px;color:var(--sub);font-weight:700;display:block;margin-bottom:6px">POSITION</label>
          <select id="self-position" class="select-field" style="margin-bottom:0">
            <option value="">—</option>
            <option value="GK" ${p.position==='GK'?'selected':''}>🧤 Goalkeeper</option>
            <option value="DF" ${p.position==='DF'?'selected':''}>🛡️ Defender</option>
            <option value="MF" ${p.position==='MF'?'selected':''}>⚙️ Midfielder</option>
            <option value="FW" ${p.position==='FW'?'selected':''}>⚡ Forward</option>
          </select>
        </div>
        <div style="flex:1"><label style="font-size:9px;color:var(--sub);font-weight:700;display:block;margin-bottom:6px">PREFERRED FOOT</label>
          <select id="self-foot" class="select-field" style="margin-bottom:0">
            <option value="">—</option>
            <option value="Left" ${p.preferredFoot==='Left'?'selected':''}>🦶 Left</option>
            <option value="Right" ${p.preferredFoot==='Right'?'selected':''}>🦶 Right</option>
            <option value="Both" ${p.preferredFoot==='Both'?'selected':''}>🦶 Both</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <div style="flex:1"><label style="font-size:9px;color:var(--sub);font-weight:700;display:block;margin-bottom:6px">AGE</label><input type="number" id="self-age" class="select-field" style="margin-bottom:0" min="1" max="99" value="${p.age||''}" placeholder="—"></div>
        <div style="flex:1"><label style="font-size:9px;color:var(--sub);font-weight:700;display:block;margin-bottom:6px">JERSEY #</label><input type="number" id="self-jersey" class="select-field" style="margin-bottom:0" min="0" max="99" value="${p.jerseyNumber!=null?p.jerseyNumber:''}" placeholder="—"></div>
      </div>
      <div class="field"><label>Favorite Real-World Team</label><input id="self-fav-team" type="text" value="${p.favoriteTeam||''}" placeholder="e.g. Al Ahly"></div>
      <div class="field"><label>Bio (max 150 chars)</label><textarea id="self-bio" maxlength="150" rows="3" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:13px 15px;color:var(--text);font-family:'Rajdhani',sans-serif;font-size:14px;resize:vertical;outline:none">${p.bio||''}</textarea></div>
      <button class="btn btn-blue" onclick="selfUpdateClubInfo(${idx})">UPDATE CLUB CARD</button>
    </div>`;
  document.getElementById('modal-edit-profile').classList.add('active');
}

// ============================================================
// 🖼️ SHAREABLE PLAYER CARD — FIFA-style card generated entirely
// in-browser with Canvas (no new storage needed). Card colors
// change based on the player's level tier. Uses Web Share API
// when available (mobile), falls back to a direct PNG download.
// ============================================================
function cardLevelTier(lvl){
  if(lvl>=90)return{name:'LEGEND',grad:['#fff6d8','#f0b429','#8b5cf6'],text:'#241a0a'};
  if(lvl>=70)return{name:'ELITE',grad:['#fff1cf','#f0b429','#b8790a'],text:'#241a0a'};
  if(lvl>=50)return{name:'VETERAN',grad:['#ecd9ff','#a855f7','#5b1f96'],text:'#ffffff'};
  if(lvl>=30)return{name:'REGULAR',grad:['#d7edff','#4dabf7','#155f9e'],text:'#ffffff'};
  if(lvl>=15)return{name:'ROOKIE',grad:['#eceef4','#9a9ab0','#4c4c62'],text:'#ffffff'};
  return{name:'AMATEUR',grad:['#ecd5b8','#b97a45','#6b3e1c'],text:'#ffffff'};
}
function cardRoundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function cardLoadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=src;
  });
}
function cardFmtValue(v){
  return v>=1000000?`€${(v/1000000).toFixed(1)}M`:`€${(v/1000).toFixed(0)}K`;
}
async function generatePlayerCardCanvas(p){
  const W=340,H=520;
  const canvas=document.createElement('canvas');
  canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');
  const lvl=getLevelFromXP(p.stats?.xp||0);
  const tier=cardLevelTier(lvl);
  const s=p.stats||{};

  cardRoundRect(ctx,0,0,W,H,26);
  const bgGrad=ctx.createLinearGradient(0,0,W,H);
  bgGrad.addColorStop(0,tier.grad[0]);
  bgGrad.addColorStop(0.5,tier.grad[1]);
  bgGrad.addColorStop(1,tier.grad[2]);
  ctx.fillStyle=bgGrad;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle='rgba(255,255,255,0.35)';
  ctx.lineWidth=10;
  ctx.beginPath();ctx.moveTo(-40,120);ctx.lineTo(120,-40);ctx.stroke();
  ctx.beginPath();ctx.moveTo(W-40,H+40);ctx.lineTo(W+40,H-40);ctx.stroke();
  ctx.restore();

  ctx.fillStyle=tier.text;
  ctx.textAlign='left';
  ctx.font='bold 48px Rajdhani, Arial';
  ctx.fillText(String(lvl),26,68);
  ctx.font='bold 13px Rajdhani, Arial';
  ctx.fillText(tier.name,26,88);
  if(p.jerseyNumber!=null&&p.jerseyNumber!==''){
    ctx.font='bold 12px Rajdhani, Arial';
    ctx.globalAlpha=0.85;
    ctx.fillText('#'+p.jerseyNumber,26,102);
    ctx.globalAlpha=1;
  }

  ctx.textAlign='right';
  ctx.font='bold 13px Rajdhani, Arial';
  ctx.fillText(p.tier==='pro'?'⭐ PRO':'🌱 YOUTH',W-26,42);
  if(p.position){
    ctx.font='bold 12px Rajdhani, Arial';
    ctx.globalAlpha=0.85;
    ctx.fillText(p.position,W-26,58);
    ctx.globalAlpha=1;
  }

  const photoSize=136,photoX=W/2,photoY=178;
  ctx.save();
  ctx.beginPath();ctx.arc(photoX,photoY,photoSize/2,0,Math.PI*2);ctx.closePath();ctx.clip();
  if(p.photo){
    try{
      const img=await cardLoadImage(p.photo);
      ctx.drawImage(img,photoX-photoSize/2,photoY-photoSize/2,photoSize,photoSize);
    }catch(e){
      ctx.fillStyle='rgba(255,255,255,0.3)';
      ctx.fillRect(photoX-photoSize/2,photoY-photoSize/2,photoSize,photoSize);
    }
  } else {
    ctx.fillStyle='rgba(255,255,255,0.28)';
    ctx.fillRect(photoX-photoSize/2,photoY-photoSize/2,photoSize,photoSize);
    ctx.fillStyle=tier.text;
    ctx.font='bold 46px Rajdhani, Arial';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(initials(p.name),photoX,photoY);
    ctx.textBaseline='alphabetic';
  }
  ctx.restore();
  ctx.beginPath();ctx.arc(photoX,photoY,photoSize/2,0,Math.PI*2);
  ctx.lineWidth=5;ctx.strokeStyle=tier.text;ctx.stroke();

  ctx.fillStyle=tier.text;
  ctx.textAlign='center';
  ctx.font='bold 25px Rajdhani, Arial';
  let displayName=p.name.toUpperCase();
  if(ctx.measureText(displayName).width>W-50){
    while(ctx.measureText(displayName+'…').width>W-50&&displayName.length>3)displayName=displayName.slice(0,-1);
    displayName+='…';
  }
  ctx.fillText(displayName,W/2,272);

  ctx.strokeStyle='rgba(0,0,0,0.18)';
  ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(40,292);ctx.lineTo(W-40,292);ctx.stroke();

  const statList=[
    {label:'ELO',val:s.elo||1000},
    {label:'GOALS ⚽',val:s.goals||0},
    {label:'TROPHIES 🏆',val:s.trophies||0},
    {label:'BOOTS 🥾',val:s.goldenBoots||0},
    {label:'MVP 🏅',val:s.tournamentMVPs||0},
    {label:'VALUE',val:cardFmtValue(p.marketValue||500000)}
  ];
  const cols=2,colW=(W-80)/cols;
  ctx.textAlign='center';
  statList.forEach((st,i)=>{
    const col=i%cols,row=Math.floor(i/cols);
    const x=40+colW*col+colW/2;
    const y=326+row*52;
    ctx.font='bold 22px Rajdhani, Arial';
    ctx.fillStyle=tier.text;
    ctx.fillText(String(st.val),x,y);
    ctx.font='bold 10px Rajdhani, Arial';
    ctx.globalAlpha=0.72;
    ctx.fillText(st.label,x,y+16);
    ctx.globalAlpha=1;
  });

  ctx.font='bold 12px Rajdhani, Arial';
  ctx.fillStyle=tier.text;
  ctx.globalAlpha=0.65;
  ctx.textAlign='center';
  ctx.fillText('F O O T B O L A',W/2,H-22);
  ctx.globalAlpha=1;

  return canvas;
}
async function shareCard(idx){
  const db=getDB();const p=db.players[idx];if(!p)return;
  snack('🖼️ Generating card...');
  try{
    const canvas=await generatePlayerCardCanvas(p);
    canvas.toBlob(async(blob)=>{
      if(!blob){snack('❌ Failed to generate card.');return;}
      const fileName=`${p.name.replace(/\s+/g,'_')}_FOOTBOLA_Card.png`;
      let shared=false;
      if(navigator.share&&navigator.canShare){
        try{
          const file=new File([blob],fileName,{type:'image/png'});
          if(navigator.canShare({files:[file]})){
            await navigator.share({files:[file],title:`${p.name} — FOOTBOLA Card`,text:`Check out ${p.name}'s FOOTBOLA player card! ⚽`});
            shared=true;
          }
        }catch(e){ /* user cancelled the share sheet — fall back to download below */ }
      }
      if(!shared){
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url;a.download=fileName;
        document.body.appendChild(a);a.click();document.body.removeChild(a);
        URL.revokeObjectURL(url);
        snack('⬇️ Card downloaded!');
      }
    },'image/png');
  }catch(e){
    console.error(e);
    snack('❌ Could not generate the card.');
  }
}

// ============================================================
// PROFILE UPDATES (FIXED ASYNC & NO BULLDOZER)
// ============================================================
async function selfUpdatePhoto(idx){
  const photo=document.getElementById('self-photo-data').value;
  if(!photo){snack('Select a photo');return}
  const db=getDB();db.players[idx].photo=photo;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  renderUserBadge();snack('✅ Photo updated');closeModal('modal-edit-profile');renderLocker();
}

async function selfUpdateName(idx){
  const name=document.getElementById('self-name').value.trim();
  if(!name){snack('Enter a name');return}
  const db=getDB();db.players[idx].name=name;
  if(currentUser)currentUser.name=name;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  renderUserBadge();snack('✅ Name updated');closeModal('modal-edit-profile');renderLocker();
}

async function selfUpdatePin(idx){
  const cur=document.getElementById('self-cur-pin').value.trim();
  const nw=document.getElementById('self-new-pin').value.trim();
  const db=getDB();const p=db.players[idx];
  if(p.pin!==cur){snack('❌ Current PIN incorrect');return}
  if(!/^\d{4}$/.test(nw)){snack('New PIN must be 4 digits');return}
  p.pin=nw;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack('✅ PIN changed');closeModal('modal-edit-profile');
}

async function selfUpdateClubInfo(idx){
  const db=getDB();const p=db.players[idx];if(!p)return;
  p.position=document.getElementById('self-position').value;
  p.preferredFoot=document.getElementById('self-foot').value;
  const ageVal=parseInt(document.getElementById('self-age').value);
  p.age=isNaN(ageVal)?null:Math.max(1,Math.min(99,ageVal));
  const jerseyVal=parseInt(document.getElementById('self-jersey').value);
  p.jerseyNumber=isNaN(jerseyVal)?null:Math.max(0,Math.min(99,jerseyVal));
  p.favoriteTeam=document.getElementById('self-fav-team').value.trim();
  p.bio=document.getElementById('self-bio').value.trim().slice(0,150);
  await saveSinglePlayer(p);
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack('✅ Club card updated');closeModal('modal-edit-profile');renderLocker();
}

// ============================================================
// HALL OF FAME
// ============================================================
// ============================================================
// LEAGUE RECORDS ENGINE — most wins, goals, MOTM, team wins,
// longest win streak, and global average goals per match.
// ============================================================
function computeLeagueRecords(db){
  const players=db.players.filter(p=>p.status!=='banned');
  const winsCount={},motmCount={},teamWins={};
  let totalGoalsAll=0,totalMatchesAll=0;

  db.tournaments.forEach(t=>{
    (t.matches||[]).forEach(m=>{
      totalGoalsAll+=(m.goalsA||0)+(m.goalsB||0);
      totalMatchesAll++;
      if(m.motm)motmCount[m.motm]=(motmCount[m.motm]||0)+1;
      if(t.type==='1v1'){
        if(m.goalsA>m.goalsB)winsCount[m.aId]=(winsCount[m.aId]||0)+1;
        else if(m.goalsB>m.goalsA)winsCount[m.bId]=(winsCount[m.bId]||0)+1;
      } else {
        const tA=t.standings.find(s=>s.id===m.aId),tB=t.standings.find(s=>s.id===m.bId);
        if(m.goalsA>m.goalsB&&tA){
          winsCount[tA.proId]=(winsCount[tA.proId]||0)+1;winsCount[tA.youthId]=(winsCount[tA.youthId]||0)+1;
          teamWins[tA.id]=teamWins[tA.id]||{count:0,name:tA.name};teamWins[tA.id].count++;
        } else if(m.goalsB>m.goalsA&&tB){
          winsCount[tB.proId]=(winsCount[tB.proId]||0)+1;winsCount[tB.youthId]=(winsCount[tB.youthId]||0)+1;
          teamWins[tB.id]=teamWins[tB.id]||{count:0,name:tB.name};teamWins[tB.id].count++;
        }
      }
    });
  });

  let mostWins=null,bwc=0;
  Object.entries(winsCount).forEach(([pid,c])=>{if(c>bwc){bwc=c;const p=players.find(x=>x.id===pid);if(p)mostWins={name:p.name,count:c};}});

  let mostGoals=null,bgc=0;
  players.forEach(p=>{const g=p.stats?.goals||0;if(g>bgc){bgc=g;mostGoals={name:p.name,count:g};}});

  let mostMotm=null,bmc=0;
  Object.entries(motmCount).forEach(([name,c])=>{if(c>bmc){bmc=c;mostMotm={name,count:c};}});

  let mostTeamWins=null,btc=0;
  Object.values(teamWins).forEach(tw=>{if(tw.count>btc){btc=tw.count;mostTeamWins={name:tw.name,count:tw.count};}});

  let longestStreak=null,bsc=0;
  players.forEach(p=>{
    const matches=[];
    db.tournaments.forEach(t=>{
      (t.matches||[]).forEach(m=>{
        if(t.type==='1v1'){
          if(m.aId===p.id||m.bId===p.id){
            const won=(m.aId===p.id&&m.goalsA>m.goalsB)||(m.bId===p.id&&m.goalsB>m.goalsA);
            matches.push({ts:m.ts,won});
          }
        } else if(m.events&&m.events.goals&&m.events.goals[p.id]!==undefined){
          const tA=t.standings.find(s=>s.id===m.aId),tB=t.standings.find(s=>s.id===m.bId);
          const onA=tA&&(tA.proId===p.id||tA.youthId===p.id);
          const won=onA?m.goalsA>m.goalsB:m.goalsB>m.goalsA;
          matches.push({ts:m.ts,won});
        }
      });
    });
    matches.sort((a,b)=>a.ts-b.ts);
    let cur=0,max=0;
    matches.forEach(m=>{if(m.won){cur++;max=Math.max(max,cur);}else cur=0;});
    if(max>bsc){bsc=max;longestStreak={name:p.name,count:max};}
  });

  const avgGoalsPerMatch=totalMatchesAll?(totalGoalsAll/totalMatchesAll).toFixed(2):'0.00';
  return{mostWins,mostGoals,mostMotm,mostTeamWins,longestStreak,avgGoalsPerMatch};
}

function renderLeagueRecords(db){
  const r=computeLeagueRecords(db);
  const cell=(icon,label,data,color)=>`<div class="stat-cell" style="padding:12px 8px;text-align:left${color?`;border-color:${color}`:''}">
    <div style="font-size:9px;font-weight:700;letter-spacing:1px;color:var(--sub);text-transform:uppercase;margin-bottom:4px">${icon} ${label}</div>
    <div style="font-size:14px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${data?data.name:'—'}</div>
    ${data?`<div style="font-size:11px;color:${color||'var(--sub)'};font-weight:700;margin-top:1px">${data.count}</div>`:''}
  </div>`;
  return `<div class="settings-card" style="margin:0 14px 14px">
    <div class="settings-title" style="font-size:11px">🏅 League Records</div>
    <div class="stat-grid" style="grid-template-columns:1fr 1fr;gap:8px">
      ${cell('🔥','Most Wins',r.mostWins,'var(--green)')}
      ${cell('⚽','Top Scorer',r.mostGoals,'var(--gold)')}
      ${cell('⭐','Most MOTM',r.mostMotm,'var(--purple)')}
      ${cell('👯','Best Duo',r.mostTeamWins,'var(--blue)')}
      ${cell('📈','Longest Win Streak',r.longestStreak,'var(--green)')}
    </div>
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:11px;color:var(--sub);font-weight:700">⚽ Avg Goals / Match (all-time)</span>
      <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--gold)">${r.avgGoalsPerMatch}</span>
    </div>
  </div>`;
}

// ============================================================
// 2v2 CHEMISTRY — best-performing Pro+Youth duos, ranked by win
// rate together. A pair needs at least 3 matches played together
// to qualify for the ranking (avoids a fluky 1-match 100% record
// topping the board).
// ============================================================
function computeChemistry(db){
  const pairs={};
  db.tournaments.forEach(t=>{
    if(t.type!=='2v2')return;
    (t.matches||[]).forEach(m=>{
      const tA=t.standings.find(s=>s.id===m.aId),tB=t.standings.find(s=>s.id===m.bId);
      [tA,tB].forEach(entry=>{
        if(!entry||!entry.proId||!entry.youthId)return;
        const key=entry.proId+'::'+entry.youthId;
        if(!pairs[key])pairs[key]={proId:entry.proId,youthId:entry.youthId,proName:entry.proName,youthName:entry.youthName,matches:0,wins:0,draws:0,losses:0,goals:0};
        const rec=pairs[key];
        rec.matches++;
        const isA=entry===tA;
        const myGoals=isA?m.goalsA:m.goalsB;
        const oppGoals=isA?m.goalsB:m.goalsA;
        if(myGoals>oppGoals)rec.wins++;else if(myGoals<oppGoals)rec.losses++;else rec.draws++;
        if(m.events&&m.events.goals)rec.goals+=(m.events.goals[entry.proId]||0)+(m.events.goals[entry.youthId]||0);
      });
    });
  });
  const list=Object.values(pairs).filter(p=>p.matches>=3);
  list.forEach(p=>{p.winRate=p.matches?Math.round((p.wins/p.matches)*100):0;});
  list.sort((a,b)=>b.winRate-a.winRate||b.matches-a.matches);
  return list.slice(0,5);
}
function renderChemistryCard(db){
  const list=computeChemistry(db);
  return `<div class="settings-card" style="margin:0 14px 14px">
    <div class="settings-title" style="font-size:11px">🧩 2v2 Chemistry — Best Duos</div>
    ${list.length===0
      ?`<div style="font-size:12px;color:var(--sub);padding:6px 0">No duo has played 3+ matches together yet — team up more in 2v2 tournaments!</div>`
      :list.map((p,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i===0?'👑 ':''}⭐ ${p.proName} & 🌱 ${p.youthName}</div>
          <div style="font-size:10px;color:var(--sub);margin-top:2px">${p.matches} matches together · ${p.goals} combined goals</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--green)">${p.winRate}%</div>
          <div style="font-size:9px;color:var(--sub)">WIN RATE</div>
        </div>
      </div>`).join('')}
  </div>`;
}

// ============================================================
// HEAD-TO-HEAD — full history of one player against another,
// combined across 1v1 and 2v2 matches (any match where the two
// were on opposing sides counts; teammates in 2v2 are excluded).
// ============================================================
function computeHeadToHead(idA,idB,db){
  const meetings=[];
  let aWins=0,bWins=0,draws=0,aGoals=0,bGoals=0;
  db.tournaments.forEach(t=>{
    (t.matches||[]).forEach(m=>{
      let sideA=null,sideB=null;
      if(t.type==='1v1'){
        if(m.aId===idA)sideA='A';else if(m.bId===idA)sideA='B';
        if(m.aId===idB)sideB='A';else if(m.bId===idB)sideB='B';
      } else {
        const tA=t.standings.find(s=>s.id===m.aId),tB=t.standings.find(s=>s.id===m.bId);
        if(tA&&(tA.proId===idA||tA.youthId===idA))sideA='A';
        else if(tB&&(tB.proId===idA||tB.youthId===idA))sideA='B';
        if(tA&&(tA.proId===idB||tA.youthId===idB))sideB='A';
        else if(tB&&(tB.proId===idB||tB.youthId===idB))sideB='B';
      }
      if(!sideA||!sideB||sideA===sideB)return;
      const aTeamScore=sideA==='A'?m.goalsA:m.goalsB;
      const bTeamScore=sideA==='A'?m.goalsB:m.goalsA;
      let result='D';
      if(aTeamScore>bTeamScore){aWins++;result='W';}
      else if(aTeamScore<bTeamScore){bWins++;result='L';}
      else draws++;
      aGoals+=(m.events&&m.events.goals&&m.events.goals[idA])||0;
      bGoals+=(m.events&&m.events.goals&&m.events.goals[idB])||0;
      meetings.push({ts:m.ts,aTeamScore,bTeamScore,result,tName:t.name});
    });
  });
  meetings.sort((a,b)=>a.ts-b.ts);
  return{meetings,totalMeetings:meetings.length,aWins,bWins,draws,aGoals,bGoals};
}
function openH2HModal(){
  const db=getDB();
  const eligible=db.players.filter(p=>p.status!=='banned');
  const opts=eligible.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  document.getElementById('h2h-body').innerHTML=`
    <div class="field"><label>Player 1</label><select id="h2h-a" class="select-field" onchange="renderH2HResult()"><option value="">— Select —</option>${opts}</select></div>
    <div class="field"><label>Player 2</label><select id="h2h-b" class="select-field" onchange="renderH2HResult()"><option value="">— Select —</option>${opts}</select></div>
    <div id="h2h-result"></div>`;
  document.getElementById('modal-h2h').classList.add('active');
}
function renderH2HResult(){
  const db=getDB();
  const aId=document.getElementById('h2h-a').value;
  const bId=document.getElementById('h2h-b').value;
  const res=document.getElementById('h2h-result');
  if(!aId||!bId){res.innerHTML='';return}
  if(aId===bId){res.innerHTML='<div style="font-size:12px;color:var(--red);text-align:center;padding:10px 0">Pick two different players.</div>';return}
  const a=db.players.find(x=>x.id===aId),b=db.players.find(x=>x.id===bId);
  if(!a||!b)return;
  const h2h=computeHeadToHead(aId,bId,db);
  if(h2h.totalMeetings===0){
    res.innerHTML=`<div style="text-align:center;padding:24px 0;color:var(--sub);font-size:13px">${a.name} and ${b.name} have never faced each other yet.</div>`;
    return;
  }
  const recentHtml=h2h.meetings.slice(-8).reverse().map(m=>{
    const resColor=m.result==='W'?'var(--green)':m.result==='L'?'var(--red)':'var(--sub)';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:11px;color:var(--sub);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.tName}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:${resColor}">${m.aTeamScore}–${m.bTeamScore}</div>
      <div style="font-size:9px;color:var(--sub);width:56px;text-align:right;flex-shrink:0">${timeAgo(m.ts)}</div>
    </div>`;
  }).join('');
  res.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 14px">
      <div style="text-align:center;flex:1"><div class="pav" style="width:52px;height:52px;margin:0 auto 6px;font-size:16px">${a.photo?`<img src="${a.photo}">`:initials(a.name)}</div><div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.name}</div></div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--sub);flex-shrink:0;padding:0 8px">VS</div>
      <div style="text-align:center;flex:1"><div class="pav" style="width:52px;height:52px;margin:0 auto 6px;font-size:16px">${b.photo?`<img src="${b.photo}">`:initials(b.name)}</div><div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${b.name}</div></div>
    </div>
    <div class="stat-grid" style="grid-template-columns:1fr 1fr 1fr;gap:6px">
      <div class="stat-cell"><div class="stat-val" style="color:var(--green);font-size:24px">${h2h.aWins}</div><div class="stat-lbl">${a.name} Wins</div></div>
      <div class="stat-cell"><div class="stat-val" style="font-size:24px">${h2h.draws}</div><div class="stat-lbl">Draws</div></div>
      <div class="stat-cell"><div class="stat-val" style="color:var(--green);font-size:24px">${h2h.bWins}</div><div class="stat-lbl">${b.name} Wins</div></div>
    </div>
    <div style="display:flex;justify-content:space-around;margin:12px 0;font-size:12px;color:var(--sub)">
      <span>⚽ ${a.name}: <strong style="color:var(--gold)">${h2h.aGoals}</strong></span>
      <span>⚽ ${b.name}: <strong style="color:var(--gold)">${h2h.bGoals}</strong></span>
    </div>
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--sub);margin:14px 0 8px;text-transform:uppercase">Recent Meetings (${h2h.totalMeetings} total)</div>
    ${recentHtml}`;
}

function renderHistory(){
  const db=getDB();const el=document.getElementById('tab-history');
  const sorted=[...db.players].sort((a,b)=>{const eloA=a.stats?.elo||1000,eloB=b.stats?.elo||1000;if(eloB!==eloA)return eloB-eloA;return(b.stats?.points||0)-(a.stats?.points||0);});
  if(sorted.length===0){el.innerHTML=`<div class="empty-state"><div class="empty-ico">🏛️</div><div class="empty-txt">Hall of Fame is empty.<br>Complete a tournament to fill it.</div></div>`;return;}
  el.innerHTML=`<div class="sec-hdr"><div class="sec-ttl">👑 Hall of Fame (Global Rank)</div>
    <div style="display:flex;gap:6px">
      <button onclick="openH2HModal()" style="display:flex;align-items:center;gap:4px;background:rgba(77,171,247,0.1);border:1px solid rgba(77,171,247,0.25);border-radius:9px;padding:7px 11px;font-family:'Rajdhani',sans-serif;font-size:12px;font-weight:700;color:var(--blue);cursor:pointer">⚔️ H2H</button>
      <button onclick="openCompareModal()" style="display:flex;align-items:center;gap:4px;background:rgba(240,180,41,0.1);border:1px solid rgba(240,180,41,0.25);border-radius:9px;padding:7px 13px;font-family:'Rajdhani',sans-serif;font-size:12px;font-weight:700;color:var(--gold);cursor:pointer">⚖️ COMPARE</button>
    </div>
  </div>
  ${renderLeagueRecords(db)}
  ${renderChemistryCard(db)}
  <div class="hof-list">
    ${sorted.map((p,i)=>{
      const s=p.stats||{};const xp=s.xp||0;const lvl=getLevelFromXP(xp);const lvlTitle=getLevelTitle(lvl);const elo=s.elo||1000;const pIdx=db.players.indexOf(p);
      return`<div class="hof-item ${i===0?'r1':''}" onclick="openProfile(${pIdx},false)">
        <div class="rank-n">${i===0?'👑':i+1}</div>${avHTML(p,46)}
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">${p.name}<span class="lvl-badge" style="font-size:9px">LVL ${lvl}</span></div>
          <div style="font-size:11px;color:var(--sub);margin-top:2px;font-weight:600">${lvlTitle}</div>
          <div class="hof-stats">
            <div class="sp">🌐&thinsp;<strong style="color:var(--purple)">${elo} ELO</strong></div>
            <div class="sp">🏆&thinsp;<strong>${s.trophies||0}</strong></div>
            <div class="sp">🥾&thinsp;<strong style="color:var(--gold)">${s.goldenBoots||0}</strong></div>
            <div class="sp">⚽&thinsp;<strong>${s.goals||0}</strong></div>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ============================================================
// PLAYER COMPARISON
// ============================================================
function playerTournamentCount(pid,db){
  return db.tournaments.filter(t=>t.type==='1v1'?t.standings.some(s=>s.id===pid):t.standings.some(s=>s.proId===pid||s.youthId===pid)).length;
}
function computeWinRateQuick(pid,db){
  let total=0,wins=0;
  db.tournaments.forEach(t=>{
    (t.matches||[]).forEach(m=>{
      if(t.type==='1v1'){
        if(m.aId===pid||m.bId===pid){
          total++;
          if((m.aId===pid&&m.goalsA>m.goalsB)||(m.bId===pid&&m.goalsB>m.goalsA))wins++;
        }
      } else if(m.events&&m.events.goals&&m.events.goals[pid]!==undefined){
        const tA=t.standings.find(s=>s.id===m.aId),tB=t.standings.find(s=>s.id===m.bId);
        const onA=tA&&(tA.proId===pid||tA.youthId===pid);
        total++;
        if(onA?m.goalsA>m.goalsB:m.goalsB>m.goalsA)wins++;
      }
    });
  });
  return total?Math.round((wins/total)*100):0;
}
function openCompareModal(){
  const db=getDB();
  const eligible=db.players.filter(p=>p.status!=='banned');
  const opts=eligible.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  document.getElementById('compare-body').innerHTML=`
    <div class="field"><label>Player 1</label><select id="cmp-a" class="select-field" onchange="renderCompareResult()"><option value="">— Select —</option>${opts}</select></div>
    <div class="field"><label>Player 2</label><select id="cmp-b" class="select-field" onchange="renderCompareResult()"><option value="">— Select —</option>${opts}</select></div>
    <div id="compare-result"></div>`;
  document.getElementById('modal-compare').classList.add('active');
}
function renderCompareResult(){
  const db=getDB();
  const aId=document.getElementById('cmp-a').value;
  const bId=document.getElementById('cmp-b').value;
  const res=document.getElementById('compare-result');
  if(!aId||!bId){res.innerHTML='';return}
  if(aId===bId){res.innerHTML='<div style="font-size:12px;color:var(--red);text-align:center;padding:10px 0">Pick two different players.</div>';return}
  const a=db.players.find(x=>x.id===aId),b=db.players.find(x=>x.id===bId);
  if(!a||!b)return;
  const metrics=[
    {label:'Market Value',raw:p=>p.marketValue||500000,fmt:v=>v>=1000000?`€${(v/1000000).toFixed(2)}M`:`€${(v/1000).toFixed(0)}K`},
    {label:'Goals',raw:p=>p.stats?.goals||0,fmt:v=>v},
    {label:'Tournaments',raw:p=>playerTournamentCount(p.id,db),fmt:v=>v},
    {label:'Win Rate',raw:p=>computeWinRateQuick(p.id,db),fmt:v=>v+'%'},
    {label:'XP',raw:p=>p.stats?.xp||0,fmt:v=>v},
    {label:'Level',raw:p=>getLevelFromXP(p.stats?.xp||0),fmt:v=>v},
    {label:'ELO',raw:p=>p.stats?.elo||1000,fmt:v=>v},
    {label:'Trophies 🏆',raw:p=>p.stats?.trophies||0,fmt:v=>v},
  ];
  res.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 12px">
      <div style="text-align:center;flex:1"><div class="pav" style="width:52px;height:52px;margin:0 auto 6px;font-size:16px">${a.photo?`<img src="${a.photo}">`:initials(a.name)}</div><div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.name}</div></div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--sub);flex-shrink:0;padding:0 8px">VS</div>
      <div style="text-align:center;flex:1"><div class="pav" style="width:52px;height:52px;margin:0 auto 6px;font-size:16px">${b.photo?`<img src="${b.photo}">`:initials(b.name)}</div><div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${b.name}</div></div>
    </div>
    ${metrics.map(m=>{
      const va=m.raw(a),vb=m.raw(b);
      const aBetter=va>vb,bBetter=vb>va;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 4px;border-bottom:1px solid var(--border)">
        <span style="flex:1;text-align:center;font-weight:800;font-size:13px;color:${aBetter?'var(--green)':'var(--text)'}">${m.fmt(va)}</span>
        <span style="width:100px;text-align:center;font-size:9px;color:var(--sub);letter-spacing:0.5px;text-transform:uppercase;flex-shrink:0">${m.label}</span>
        <span style="flex:1;text-align:center;font-weight:800;font-size:13px;color:${bBetter?'var(--green)':'var(--text)'}">${m.fmt(vb)}</span>
      </div>`;
    }).join('')}
    <div style="font-size:10px;color:var(--sub);text-align:center;margin-top:12px">⚠️ Speed rating isn't tracked in the app yet.</div>`;
}

// ============================================================
// TRANSFER MARKET
// ============================================================
function renderMarket(){
  const db=getDB();const isAdmin=currentUser?.type==='admin';
  const el=document.getElementById('market-content');
  if(db.players.length===0){
    el.innerHTML=`<div class="empty-state"><div class="empty-ico">💸</div><div class="empty-txt">No players in the market yet.</div></div>`;
    return;
  }
  const allSorted=[...db.players].sort((a,b)=>(b.marketValue||500000)-(a.marketValue||500000));
  const totalValue=allSorted.reduce((sum,p)=>sum+(p.marketValue||500000),0);
  const totalStr=totalValue>=1000000?`€${(totalValue/1000000).toFixed(2)}M`:`€${(totalValue/1000).toFixed(0)}K`;

  const searchTerm=(document.getElementById('market-search')?.value||'').trim().toLowerCase();
  const advRange=getAdvRange('market');
  let sorted=allSorted;
  if(searchTerm)sorted=sorted.filter(p=>p.name.toLowerCase().includes(searchTerm));
  if(marketFilterTier==='pro')sorted=sorted.filter(p=>p.tier==='pro');
  else if(marketFilterTier==='youth')sorted=sorted.filter(p=>p.tier!=='pro');
  sorted=sorted.filter(p=>passesAdvFilter(p,advRange));

  // 🔥 Top Risers — players whose value went up since the last change
  const risers=[...db.players]
    .filter(p=>p.previousMarketValue!=null && (p.marketValue||0) > p.previousMarketValue)
    .sort((a,b)=>(b.marketValue-b.previousMarketValue)-(a.marketValue-a.previousMarketValue))
    .slice(0,3);
  const risersHtml = risers.length ? `
    <div class="settings-card" style="padding:12px;margin:0 14px 10px">
      <div class="settings-title" style="font-size:11px;color:var(--green)">🔥 Top Risers</div>
      ${risers.map(p=>{
        const gain=p.marketValue-p.previousMarketValue;
        const gainStr=gain>=1000000?`€${(gain/1000000).toFixed(2)}M`:`€${(gain/1000).toFixed(0)}K`;
        return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0"><span>${p.name}</span><span style="color:var(--green);font-weight:700">▲ +${gainStr}</span></div>`;
      }).join('')}
    </div>` : '';

  setHTMLIfChanged(el, `
    <div class="budget-bar">
      <div><div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--sub);margin-bottom:3px">TOTAL SQUAD VALUE</div><div class="budget-val">${totalStr}</div></div>
      <div style="font-size:12px;color:var(--sub);font-weight:600">${allSorted.length} Player${allSorted.length===1?'':'s'}</div>
    </div>
    ${risersHtml}
    <div style="padding:6px 14px">
      ${sorted.length===0?`<div class="empty-state"><div class="empty-ico">💸</div><div class="empty-txt">No players match your search/filter.</div></div>`:sorted.map((p,i)=>{
        const val=p.marketValue||500000;
        const valStr=val>=1000000?`€${(val/1000000).toFixed(2)}M`:`€${(val/1000).toFixed(0)}K`;
        const xp=p.stats?.xp||0;const lvl=getLevelFromXP(xp);
        let trendHtml='';
        if(p.previousMarketValue!=null){
          if(val>p.previousMarketValue)trendHtml=`<span style="color:var(--green);font-size:11px;font-weight:700">▲</span>`;
          else if(val<p.previousMarketValue)trendHtml=`<span style="color:var(--red);font-size:11px;font-weight:700">▼</span>`;
          else trendHtml=`<span style="color:var(--sub);font-size:11px;font-weight:700">–</span>`;
        }
        return`<div class="market-card">
          ${avHTML(p,44)}
          <div style="flex:1">
            <div style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">${p.name}<span class="lvl-badge">LVL ${lvl}</span></div>
            <div style="font-size:12px;color:var(--sub);margin-top:2px;font-weight:600">${p.tier==='pro'?'⭐ PRO':'🌱 YOUTH'} · ${p.stats?.goals||0} goals</div>
          </div>
          <div>
            <div class="market-val">${trendHtml} ${valStr}</div>
            <div class="market-val-lbl">VALUE</div>
            ${isAdmin?`<button class="bid-btn" style="margin-top:6px" onclick="adjustValue('${p.id}')">ADJUST</button>`:`<button class="bid-btn" style="margin-top:6px;opacity:0.5;cursor:default">BID</button>`}
          </div>
        </div>`;
      }).join('')}
    </div>`);
}

async function adjustValue(pid){
  const db=getDB();const p=db.players.find(x=>x.id===pid);
  if(!p)return;
  const cur=((p.marketValue||500000)/1000000).toFixed(2);
  const input=prompt(`Set new market value for ${p.name} (in millions €):`,cur);
  if(!input||isNaN(parseFloat(input)))return;
  p.previousMarketValue=p.marketValue||500000;
  p.marketValue=Math.round(parseFloat(input)*1000000);
  recordMarketValueHistory(p);
  // الحفظ الذكي الموجه للاعب واحد فقط
  await saveSinglePlayer(p); 
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  renderMarket();
  snack(`💰 ${p.name} valued at €${parseFloat(input).toFixed(2)}M`);
}

// ============================================================
// GOAL ANIMATION
// ============================================================
function showGoalAnimation(scoreText){
  haptic([20,40,20]);
  const ov=document.getElementById('goal-overlay');
  const txt=document.getElementById('goal-text');
  const parts=document.getElementById('goal-particles');
  txt.textContent=scoreText||'GOAL!';
  parts.innerHTML='';
  const colors=['#f0b429','#ffd166','#06d77b','#4dabf7','#ff4757'];
  for(let i=0;i<20;i++){
    const d=document.createElement('div');d.className='particle';
    const angle=(i/20)*360;const dist=120+Math.random()*100;
    const tx=Math.cos(angle*Math.PI/180)*dist;const ty=Math.sin(angle*Math.PI/180)*dist;
    d.style.cssText=`left:50%;top:50%;background:${colors[i%colors.length]};--tx:${tx}px;--ty:${ty}px;animation-delay:${Math.random()*0.2}s`;
    parts.appendChild(d);
  }
  ov.classList.add('show');
  setTimeout(()=>ov.classList.remove('show'),1800);
}

// ============================================================
// REFRESH SYSTEM
// ============================================================
// ============================================================
// REFRESH SYSTEM (HIGH-SPEED PARALLEL FETCH)
// ============================================================
// SKELETON LOADING — quick shimmer placeholders shown the moment
// a refresh starts, swapped out automatically once the real
// render*() functions run and overwrite the container.
// ============================================================
function renderSkeleton(elId,count=4){
  const el=document.getElementById(elId);if(!el)return;
  _renderCache.delete(el);
  el.innerHTML=Array.from({length:count},()=>`<div class="skel" style="height:74px;margin:0 14px 12px"></div>`).join('');
}
function showSkeletonForActiveTab(){
  const activeTab=document.querySelector('.nav-item.active')?.dataset.tab||'arena';
  const map={arena:'tournament-list',locker:'locker-list-container',market:'market-content'};
  const id=map[activeTab];
  if(id)renderSkeleton(id, activeTab==='market'?5:4);
}

// ============================================================
async function refreshData() {
    showSkeletonForActiveTab();
    snack('🔄 Syncing live data...'); 
    try {
        const [pRes, tRes, nRes, pendRes, admRes] = await Promise.all([
            supabaseClient.from('players').select('*'),
            supabaseClient.from('tournaments').select('*'), 
            supabaseClient.from('news').select('*').order('ts', { ascending: false }).limit(20),
            supabaseClient.from('pending_requests').select('*'),
            supabaseClient.from('admin_settings').select('value').eq('key', 'codes').single()
        ]);

        if(pRes.error) console.error("Players Fetch Error:", pRes.error);
        if(tRes.error) console.error("Tournaments Fetch Error:", tRes.error);

        if(pRes.data) cloudDB.players = pRes.data.map(p => ({
            id: p.player_id, name: p.name, pin: p.pin, photo: p.photo,
            tier: p.tier, stars: p.stars, stats: p.stats || {xp:0,points:0,trophies:0,goals:0}, 
            marketValue: p.market_value || 500000,
            previousMarketValue: p.previous_market_value ?? null,
            marketValueHistory: p.market_value_history ?? [],
            status: p.status || 'active',
            bio: p.bio || '', position: p.position || '', preferredFoot: p.preferred_foot || '',
            age: p.age ?? null, jerseyNumber: p.jersey_number ?? null, favoriteTeam: p.favorite_team || ''
        }));

        if(tRes.data) {
            cloudDB.tournaments = tRes.data.map(t => ({
                ...t,
                matches: t.matches || [],
                standings: t.standings || [],
                participants: t.participants || [],
                schedule: t.schedule || null,
                bracket: t.bracket || null,
                groups: t.groups || null,
                autoQualify: t.auto_qualify || false,
                archivedAt: t.archived_at || null,
                category: t.category || 'official',
                banner: t.banner || '', logo: t.logo || '', themeColor: t.theme_color || '#f0b429'
            })).sort((a,b) => b.id - a.id); 
        }

        if(nRes.data) cloudDB.news = nRes.data;
        if(pendRes.data) cloudDB.pending = pendRes.data.map(req => ({
            name: req.name, username: req.username, pin: req.pin, photo: req.photo, ts: req.ts
        }));
        if(admRes.data && admRes.data.value) cloudDB.adminCodes = admRes.data.value;

        if(currentUser) renderUserBadge();
        const activeTab = document.querySelector('.nav-item.active')?.dataset.tab || 'arena';
        renderTab(activeTab); 
        if (activeTournIdx !== null) renderTournamentScreen(); 
        
        snack('✅ Data is up to date!');
    } catch(e) { 
        console.error("Refresh Error", e); 
        snack('❌ Sync failed. Check internet.');
    }
}

// ============================================================
async function adminClearSuspension(idx) {
    const db=getDB();const p=db.players[idx];
    if(!p) return;
    if(p.status==='suspended'){
        p.status='active';snack(`✅ Suspension cleared for ${p.name}`);
        await saveSinglePlayer(p); localStorage.setItem(DB_KEY,JSON.stringify(db));
        closeModal('modal-admin-player');renderLocker();
    }
}

// ============================================================
// ENGINE 2: ELO GLOBAL RATING ALGORITHM
// ============================================================
function updateELO(db, teamA_Ids, teamB_Ids, resultA) {
    // resultA: 1 (Win), 0 (Loss), 0.5 (Draw)
    const teamA = teamA_Ids.map(id => db.players.find(x => x.id === id)).filter(Boolean);
    const teamB = teamB_Ids.map(id => db.players.find(x => x.id === id)).filter(Boolean);
    if(teamA.length === 0 || teamB.length === 0) return;

    // 1. Give everyone a default ELO of 1000 if they don't have one
    [...teamA, ...teamB].forEach(p => { p.stats.elo = p.stats.elo || 1000; });

    // 2. Calculate average team strength (Crucial for 2v2 Doubles)
    const avgEloA = teamA.reduce((sum, p) => sum + p.stats.elo, 0) / teamA.length;
    const avgEloB = teamB.reduce((sum, p) => sum + p.stats.elo, 0) / teamB.length;

    // 3. The Math Magic: Calculate expected chances of winning
    const expectedA = 1 / (1 + Math.pow(10, (avgEloB - avgEloA) / 400));
    const expectedB = 1 / (1 + Math.pow(10, (avgEloA - avgEloB) / 400));
    const K = 40; // High stakes: Maximum points you can steal in one match

    // 4. Update Team A
    teamA.forEach(p => {
        let eloChange = Math.round(K * (resultA - expectedA));
        p.stats.elo += eloChange;
    });

    // 5. Update Team B
    teamB.forEach(p => {
        let resultB = 1 - resultA;
        let eloChange = Math.round(K * (resultB - expectedB));
        p.stats.elo += eloChange;
    });
}

// ============================================================
// MARKET VALUE HISTORY — keeps a capped timeline of value changes
// per player so the profile can draw a real historical curve.
// ============================================================
function recordMarketValueHistory(p){
    if(!p)return;
    p.marketValueHistory=p.marketValueHistory||[];
    p.marketValueHistory.push({ts:Date.now(),value:p.marketValue});
    if(p.marketValueHistory.length>60)p.marketValueHistory=p.marketValueHistory.slice(-60);
}

function updatePlayerMarketValue(db, pid, matchData, applyReward=true) {
    const p = db.players.find(x => x.id === pid);
    if(!p) return;
    if(!applyReward) return; // Qualifier/Friendly tournaments: no market-value reward
    
    let val = p.marketValue || 500000; // Default starting price is 500k
    p.previousMarketValue = val;
    
    // 1. Match Result Impact
    if(matchData.result === 'win') val += 100000;
    else if(matchData.result === 'draw') val += 25000;
    else if(matchData.result === 'loss') val -= 50000;
    
    // 2. Goals Impact (+50k per goal)
    if(matchData.goals > 0) val += (matchData.goals * 50000);
    
    // 3. Cards Penalty
    if(matchData.card === 'yellow') val -= 50000;
    else if(matchData.card === 'red') val -= 150000;
    
    // Floor Limit: Player price cannot go below €100,000
    if(val < 100000) val = 100000;
    
    p.marketValue = val;
    recordMarketValueHistory(p);
}

// ============================================================
// TOURNAMENT CATEGORY — Official tournaments grant full rewards
// (trophy, golden boot, market value changes). Qualifier/Friendly
// tournaments still count toward XP, ELO, goals, cards and match
// history, but grant no cup, no golden boot, and no market-value
// changes. Legacy tournaments with no category are treated as Official.
// ============================================================
function isRewardTournament(t){
    return !t || !t.category || t.category==='official';
}

// ============================================================
// TOURNAMENT MVP ENGINE — awarded automatically when an Official
// tournament ends. Score = (goals×3) + (wins×2) + (MOTM awards×5),
// computed purely from this tournament's own matches. A player must
// have played at least 3 matches in the tournament to be eligible
// (stops a 1-match hat-trick beating someone who played the whole
// cup). Ties are broken by most goals scored in the tournament.
// Official tournaments only — Qualifier/Friendly never award this.
// ============================================================
function computeTournamentMVP(t,db){
  if(!isRewardTournament(t))return null;
  const stat={};
  const ensure=pid=>{ if(!stat[pid])stat[pid]={matches:0,goals:0,wins:0,motm:0}; return stat[pid]; };
  (t.matches||[]).forEach(m=>{
    const events=m.events||{goals:{},cards:{}};
    const tA=t.standings.find(s=>s.id===m.aId);
    const tB=t.standings.find(s=>s.id===m.bId);
    Object.keys(events.goals||{}).forEach(pid=>{
      const st=ensure(pid);
      st.matches++;
      st.goals+=events.goals[pid]||0;
      const isTeamA=t.type==='1v1'?pid===m.aId:(tA&&(pid===tA.proId||pid===tA.youthId));
      const isTeamB=t.type==='1v1'?pid===m.bId:(tB&&(pid===tB.proId||pid===tB.youthId));
      const won=(isTeamA&&m.goalsA>m.goalsB)||(isTeamB&&m.goalsB>m.goalsA);
      if(won)st.wins++;
    });
    if(m.motm){
      const mvpPlayer=db.players.find(x=>x.name===m.motm);
      if(mvpPlayer)ensure(mvpPlayer.id).motm++;
    }
  });
  let best=null,bestScore=-Infinity,bestGoals=-1;
  Object.keys(stat).forEach(pid=>{
    const st=stat[pid];
    if(st.matches<3)return;
    const score=st.goals*3+st.wins*2+st.motm*5;
    if(score>bestScore||(score===bestScore&&st.goals>bestGoals)){
      bestScore=score;bestGoals=st.goals;best={pid,score,...st};
    }
  });
  return best;
}

function awardMotmValue(db, pid) {
    const p = db.players.find(x => x.id === pid);
    if(p) {
        p.previousMarketValue = p.marketValue || 500000;
        p.marketValue = (p.marketValue || 500000) + 200000; // MOTM gets +200k bonus
        recordMarketValueHistory(p);
    }
}

// FIFA-STYLE MUSIC ENGINE — playlist now loads dynamically straight
// from the Supabase Storage bucket instead of a hardcoded list, so
// any track uploaded/removed there in the future shows up automatically
// with zero code changes, and dead files (deleted from the bucket) never
// end up stuck in the code.
// ============================================================
const MUSIC_BUCKET='music';
let playlist=[];
let playlistLoaded=false;
let playlistLoadingPromise=null;
let currentSong=0;
let bgMusic=null;

// Scans the bucket root AND one level of sub-folders for audio files,
// instead of hardcoding a folder name — so renaming/reorganizing the
// folder in Supabase Storage can never silently break the playlist again.
async function loadPlaylist(){
    if(playlistLoaded)return playlist;
    if(playlistLoadingPromise)return playlistLoadingPromise;
    playlistLoadingPromise=(async()=>{
        try{
            const audioExt=/\.(mp3|wav|m4a|ogg|aac)$/i;
            const urls=[];
            const scan=async(path)=>{
                const{data,error}=await supabaseClient.storage.from(MUSIC_BUCKET).list(path,{limit:200,sortBy:{column:'name',order:'asc'}});
                if(error||!data)return;
                for(const f of data){
                    const fullPath=path?`${path}/${f.name}`:f.name;
                    if(f.id===null){ // a sub-folder placeholder — go one level deeper
                        await scan(fullPath);
                    } else if(audioExt.test(f.name)){
                        urls.push(supabaseClient.storage.from(MUSIC_BUCKET).getPublicUrl(fullPath).data.publicUrl);
                    }
                }
            };
            await scan('');
            playlist=urls;
            playlistLoaded=true;
        }catch(e){
            console.error('Playlist load failed',e);
            playlist=[];
        }
        return playlist;
    })();
    return playlistLoadingPromise;
}

function initMusicPlayer(list){
    if(!list.length)return;
    currentSong=0;
    bgMusic=new Audio(list[currentSong]);
    bgMusic.volume=0.2;
    bgMusic.addEventListener('ended',nextSong);
}

// FIX: this used to try playing bgMusic the instant the app opened,
// before the (now-dynamic) playlist had even loaded — a silent failure
// that could interfere with the login flow. It now always waits for the
// playlist to finish loading before doing anything.
async function toggleMusic(){
    const list=await loadPlaylist();
    if(!list.length){snack('🎵 No music tracks found.');return;}
    if(!bgMusic)initMusicPlayer(list);
    if(bgMusic.paused){
        bgMusic.play().catch(e=>console.log("Browser blocked autoplay until user clicks"));
        document.getElementById('music-btn').textContent='🔊';
    }else{
        bgMusic.pause();
        document.getElementById('music-btn').textContent='🔇';
    }
}

async function nextSong(){
    const list=await loadPlaylist();
    if(!list.length)return;
    if(bgMusic)bgMusic.pause();
    currentSong=(currentSong+1)%list.length;
    bgMusic=new Audio(list[currentSong]);
    bgMusic.volume=0.2;
    bgMusic.addEventListener('ended',nextSong);
    bgMusic.play().catch(e=>console.log("Browser blocked autoplay until user clicks"));
    document.getElementById('music-btn').textContent='🔊';
    snack('🎵 Playing next track...');
}

// ============================================================
// NEWS HEADLINE VARIETY ENGINE
// ============================================================
function buildMatchHeadline(goalsA,goalsB,nameA,nameB,goalDiff){
  const pick=arr=>arr[Math.floor(Math.random()*arr.length)];
  if(goalsA===goalsB){
    const templates=[
      `🤝 STALEMATE: A tense battle ends ${goalsA}-${goalsB} between ${nameA} and ${nameB}.`,
      `🤝 SHARED SPOILS: ${nameA} and ${nameB} split the points ${goalsA}-${goalsB}.`,
      `🤝 DEADLOCK: Neither side could break through — ${goalsA}-${goalsB}.`
    ];
    return pick(templates);
  }
  const winner=goalsA>goalsB?nameA:nameB;
  const loser=goalsA>goalsB?nameB:nameA;
  const wG=Math.max(goalsA,goalsB), lG=Math.min(goalsA,goalsB);
  if(goalDiff>=4){
    const templates=[
      `💥 MASSACRE: ${winner} humiliates ${loser} ${wG}-${lG}!`,
      `💥 DEMOLITION: ${winner} destroys ${loser} ${wG}-${lG}!`,
      `💥 ROUT: ${winner} runs riot over ${loser}, ${wG}-${lG}!`
    ];
    return pick(templates);
  }
  if(goalDiff>=2){
    const templates=[
      `🔥 COMFORTABLE WIN: ${winner} cruises past ${loser} ${wG}-${lG}.`,
      `🔥 DOMINANT: ${winner} takes control against ${loser}, ${wG}-${lG}.`
    ];
    return pick(templates);
  }
  const templates=[
    `👏 SOLID WIN: ${winner} edges past ${loser} ${wG}-${lG}.`,
    `⚡ NARROW ESCAPE: ${winner} holds on to beat ${loser} ${wG}-${lG}.`,
    `👏 HARD-FOUGHT: ${winner} scrapes past ${loser} ${wG}-${lG}.`
  ];
  return pick(templates);
}

// ============================================================
// ACHIEVEMENT ENGINE (BADGES ONLY)
// ============================================================
// ============================================================
// ACHIEVEMENT ENGINE — numeric milestones, performance streaks,
// and rare/funny "hall of shame"-style badges.
// ============================================================
function checkAchievements(db, matchEvents, matchResults) {
    matchResults = matchResults || {};
    Object.keys(matchEvents.goals).forEach(pid => {
        const p = db.players.find(x => x.id === pid);
        if(!p) return;
        p.stats.badges = p.stats.badges || [];
        const newBadges = [];
        const award = (badge) => { if(!p.stats.badges.includes(badge)){ p.stats.badges.push(badge); newBadges.push(badge); } };

        // --- Performance-based (this match) ---
        if(matchEvents.goals[pid] >= 3) award('🎩 Hat-Trick');
        if((p.stats.winStreak || 0) >= 5) award('🔥 5-Win Streak');

        // --- Numeric milestones (career totals) ---
        if((p.stats.goals || 0) >= 50) award('🎯 Sniper');
        if((p.stats.goals || 0) >= 100) award('💯 Century Club (100 Goals)');
        if((p.stats.matchesPlayed || 0) >= 50) award('🎖️ Veteran (50 Matches)');
        if(playerTournamentCount(pid, db) >= 10) award('🏆 Serial Competitor (10 Cups)');

        // --- Rare / funny ---
        if((p.stats.totalLosses || 0) === 1 && matchResults[pid] === 'loss') award('😅 First Defeat');
        if(matchEvents.cards[pid] === 'red' && (p.stats.red || 0) === 1) award('🟥 Seeing Red (First Red Card)');

        if(newBadges.length > 0) {
            snack(`🏆 ${p.name} unlocked: ${newBadges.join(', ')}`);
            addNews(`🏅 ACHIEVEMENT: ${p.name} earned ${newBadges.join(', ')}!`, '🏅');
        }
    });
}

// ============================================================
// INIT (STARTUP)
// ============================================================
// ============================================================
// INIT (STARTUP) - WITH BAN/SUSPEND SESSION CHECK
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  showScreen('screen-waiting');
  document.querySelector('.waiting-title').textContent = "CONNECTING...";
  document.querySelector('.waiting-sub').textContent = "Downloading live data from server...";

  await refreshData();

  const savedSession = localStorage.getItem('footbola_session');
  if(savedSession) {
      const parsedSession = JSON.parse(savedSession);
      if (parsedSession.type === 'player') {
          const livePlayer = cloudDB.players.find(p => p.id === parsedSession.id);
          // 🔒 الطرد الفوري للمحظورين
          if (!livePlayer || livePlayer.status === 'banned' || livePlayer.status === 'suspended') {
              logout(); 
              snack('🚫 Session Expired or Account Suspended.');
              return;
          }
      }
      currentUser = parsedSession;
      enterApp();
  } else {
      setTimeout(() => showScreen('screen-auth'), 800);
  }
});

// ============================================================
// THE ULTIMATE TELEGRAM HYPE ENGINE (INTERACTIVE & ANIMATED)
// ============================================================
function sendTelegramAlert(text) {
    const token = "8723447398:AAGg-dbMpTMSg8qOiwGkWbX1VDQaIKbx1Cw";
    const chatId = "-5226636156";
    const websiteUrl = "https://footbola.netlify.app";
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    // 🎭 محرك الدراما الرياضية (The Drama Engine)
    let header = "📺 FOOTBOLA TV | بـث حـي";
    let animation = "⚡";
    let hypeText = "تغطية مستمرة لأحداث الساحة الآن...";

    if(text.includes('🏆')) {
        header = "👑 THE CHAMPION HAS ARRIVED";
        animation = "🎊✨🏆✨🎊";
        hypeText = "لحظة تاريخية! الكأس يجد صاحبه الجديد وسط احتفالات صاخبة! 🥁";
    } 
    else if(text.includes('💥')) {
        header = "🔥 MATCH EXPLOSION | إنفجار كروي";
        animation = "💣⚽🔥";
        hypeText = "أداء مرعب! الخصم لم يجد فرصة للتنفس.. تدمير شامل! 🌋";
    }
    else if(text.includes('🚨') || text.includes('🟥')) {
        header = "🚫 VAR DECISION | قرار الفار";
        animation = "🚨📢🚨";
        hypeText = "الأجواء تشتعل! البطاقة الحمراء تظهر والتوتر سيد الموقف! 😤";
    }
    else if(text.includes('🎩')) {
        header = "🎩 HAT-TRICK HERO | الهاتريك";
        animation = "🎯🎯🎯";
        hypeText = "سيدات وسادتي.. استعدوا للتصفيق! سوبر هاتريك تاريخي! 👏";
    }

    // 🏗️ تصميم هيكل الرسالة الفخم (UI Template)
    const formattedMessage = `
${animation}
<b>${header}</b>
━━━━━━━━━━━━━━━━━━━━
📣 <b>الحدث:</b>
<i>${text}</i>

🎙️ <b>تحليل المعلق:</b>
<code>${hypeText}</code>
━━━━━━━━━━━━━━━━━━━━
📍 <b>الموقع:</b> Arena Live
⏱️ <b>التوقيت:</b> ${new Date().toLocaleTimeString('ar-EG')}
`;

    // 🔘 الأزرار التفاعلية (Inline Buttons)
    const keyboard = {
        inline_keyboard: [
            [
                { text: "🏟️ دخول الملعب (Live)", url: websiteUrl },
                { text: "📊 جدول الترتيب", url: websiteUrl }
            ],
            [
                { text: "💸 سوق الانتقالات", url: websiteUrl }
            ]
        ]
    };

    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            chat_id: chatId, 
            text: formattedMessage,
            parse_mode: 'HTML',
            reply_markup: keyboard // إضافة الأزرار
        })
    }).catch(err => console.error("Telegram Integration Error", err));
}
