// E2E: BM menyiapkan data & membuat akun, MD cek toko dengan kamera+GPS, BM melihat laporan realtime, RLS, offline outbox
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..'), SHOT = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT, { recursive: true });
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const JPG = fs.readFileSync(path.join(__dirname, 'shelf.jpg'));

// ---- DB bersama (Node) ----
const DB = { profiles: [
  { app_id: 'ray', nama: 'Ray', role: 'approver', aktif: true, user_id: 'u-ray', email: 'ray@x.test' },
  { app_id: 'nadia', nama: 'Nadia', role: 'bm', aktif: true, user_id: 'u-nadia', email: 'nadia@x.test', username: 'nadia' },
  { app_id: 'wulan', nama: 'Wulan', role: 'admin', aktif: true, user_id: null },
  { app_id: 'dimas', nama: 'Dimas', role: 'md', aktif: true, user_id: null },
  { app_id: 'bagas', nama: 'Bagas', role: 'md', aktif: true, user_id: null },
  { app_id: 'yoga', nama: 'Yoga', role: 'md', aktif: true, user_id: null },
  { app_id: 'sari', nama: 'Sari', role: 'spg', aktif: true, user_id: null },
  { app_id: 'rina', nama: 'Rina', role: 'spg', aktif: true, user_id: null }],
  recs: new Map(), pins: { nadia: { pin: '2468' } }, accounts: { 'nadia@x.test': { pw: 'rahasia123', uid: 'u-nadia' }, 'ray@x.test': { pw: 'rahasia123', uid: 'u-ray' } }, uploads: [] };
const FIELD = ['visits','spgDays','tickets','tasks','lokReq','proposals','excuses','counts','returns','deliveries','invoices','tagihan','spgReported','log','seen','snap','audits'];
let OFFLINE = new Set(); const pages = [];
const role = uid => { const p = DB.profiles.find(x => x.user_id === uid && x.aktif); return p ? p.role : null; };
const mgr = r => ['approver','bm','admin'].includes(r);
let clock = Date.parse('2026-11-12T03:00:00Z'); const ts = () => new Date(clock += 1000).toISOString();
async function dbHandler(page, op, a) {
  if (OFFLINE.has(page)) return JSON.stringify({ error: { message: 'Failed to fetch' }, status: 0 });
  if (op === 'login') { const ac = DB.accounts[a.email]; if (!ac || ac.pw !== a.password) return JSON.stringify({ error: { message: 'Invalid login credentials' } }); return JSON.stringify({ uid: ac.uid }); }
  if (op === 'upload') { if (!role(a.tok) || !a.p.startsWith(a.tok + '/')) return JSON.stringify({ error: { message: 'denied' } }); DB.uploads.push(a.p); return JSON.stringify({ data: { path: a.p } }); }
  if (op === 'fn' && a.n === 'masuk') { const p = DB.profiles.find(x => x.username === a.body.username && x.user_id); const pin = p && DB.pins[p.app_id];
    if (!p || !pin) return JSON.stringify({ data: null, error: { message: 'Username atau PIN salah' } });
    if (pin.lock) return JSON.stringify({ data: { error: 'Akun dikunci' }, error: { message: 'Akun dikunci' } });
    if (pin.pin !== a.body.pin) { pin.fail = (pin.fail || 0) + 1; if (pin.fail >= 5) pin.lock = true; return JSON.stringify({ data: { error: 'Username atau PIN salah' }, error: { message: 'Username atau PIN salah' } }); }
    pin.fail = 0; return JSON.stringify({ data: { access_token: p.user_id, refresh_token: 'r' } }); }
  if (op === 'fn' && a.body.action === 'self') { const p = DB.profiles.find(x => x.user_id === a.tok); if (a.body.username && !p.username) p.username = a.body.username; DB.pins[p.app_id] = { pin: a.body.pin }; return JSON.stringify({ data: { ok: true, username: p.username } }); }
  if (op === 'fn') { const r = role(a.tok); if (!mgr(r)) return JSON.stringify({ error: { message: 'x' }, data: { error: 'Hanya Pemilik/BM/Admin' } });
    const p = DB.profiles.find(x => x.app_id === a.body.app_id); if (!p) return JSON.stringify({ data: { error: 'nf' }, error: { message: 'nf' } });
    if (a.body.action === 'create') { p.user_id = 'u-' + p.app_id; } p.username = a.body.username; DB.pins[p.app_id] = { pin: a.body.pin };
    return JSON.stringify({ data: { ok: true } }); }
  const r = role(a.tok);
  if (a.t === 'profiles') {
    if (a.op === 'upsert') { if (!mgr(r)) return JSON.stringify({ error: { message: 'rls', code: '42501' }, status: 403 });
      a.payload.forEach(row => { const p = DB.profiles.find(x => x.app_id === row.app_id); if (p) Object.assign(p, row); else DB.profiles.push(Object.assign({ user_id: null }, row)); }); return JSON.stringify({ data: null, status: 201 }); }
    if (a.op === 'delete') { if (!mgr(r)) return JSON.stringify({ error: { message: 'rls' }, status: 403 }); const id = a.f[0][2]; DB.profiles = DB.profiles.filter(p => p.app_id !== id); return JSON.stringify({ data: null, status: 204 }); }
    let rows = r ? DB.profiles.slice() : (a.f.some(f => f[1] === 'user_id') ? DB.profiles.filter(p => p.user_id === a.tok) : []);
    a.f.forEach(([k, c, v]) => { rows = rows.filter(x => k === 'eq' ? x[c] === v : x[c] > v); });
    return JSON.stringify({ data: a.single ? (rows[0] || null) : rows, status: 200 });
  }
  if (a.t === 'app_records') {
    if (a.op === 'upsert') {
      const ok = a.payload.every(row => { const ex = DB.recs.get(row.coll + '|' + row.id);
        if (mgr(r)) return true; if (!['md','spg'].includes(r)) return false; if (!FIELD.includes(row.coll)) return false;
        if (ex && ex.deleted) return false; if (row.deleted && ex && ex.created_by !== a.tok) return false; return true; });
      if (!ok) return JSON.stringify({ error: { message: 'new row violates row-level security policy', code: '42501' }, status: 403 });
      a.payload.forEach(row => { const k = row.coll + '|' + row.id, ex = DB.recs.get(k); const t = ts();
        const rec = { coll: row.coll, id: row.id, data: row.data, deleted: !!row.deleted, created_by: ex ? ex.created_by : a.tok, created_at: ex ? ex.created_at : t, updated_by: a.tok, updated_at: t };
        DB.recs.set(k, rec); pages.forEach(p => { if (p !== page && !OFFLINE.has(p)) p.evaluate(x => window.__rt && window.__rt(x), rec).catch(() => {}); }); });
      return JSON.stringify({ data: null, status: 201 });
    }
    if (!r) return JSON.stringify({ data: [], status: 200 });
    let rows = [...DB.recs.values()]; a.f.forEach(([k, c, v]) => { rows = rows.filter(x => k === 'eq' ? x[c] === v : x[c] > v); });
    rows.sort((x, y) => (x.coll + x.id).localeCompare(y.coll + y.id)); if (a.r) rows = rows.slice(a.r[0], a.r[1] + 1);
    return JSON.stringify({ data: rows, status: 200 });
  }
  return JSON.stringify({ error: { message: 'unknown' } });
}
async function newPage(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ geolocation: { latitude: -6.19085, longitude: 106.82205, accuracy: 12 }, permissions: ['geolocation'] }, opts));
  const page = await ctx.newPage(); pages.push(page);
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.errs = errs;
  await page.exposeFunction('__db', (op, a) => dbHandler(page, op, a));
  await page.route('**/*', route => { const u = new URL(route.request().url());
    if (u.hostname !== 'archi.test') return route.fulfill({ status: 200, body: '' });
    let p = u.pathname.replace(/^\/field\//, '/'); if (p === '/') p = '/index.html';
    if (p === '/vendor/supabase.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK });
    const f = path.join(OUT, p); if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    let bd=fs.readFileSync(f); if(p==='/index.html') bd=bd.toString().replace('UI={};liveStart();','window.__AF=function(c){return eval(c)};UI={};liveStart();');
    route.fulfill({ status: 200, body: bd, contentType: p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript' : p.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/octet-stream' }); });
  page.on('filechooser', fc => fc.setFiles({ name: 'cam.jpg', mimeType: 'image/jpeg', buffer: JPG }));
  await page.goto('https://archi.test/field/');
  return page;
}
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
async function login(p, e, pw) { await p.fill('#lgUser', e); await p.fill('#lgPin', pw); await p.click('#lgForm button'); await p.waitForTimeout(900); }
const click = async (p, sel) => { await p.click(sel); await p.waitForTimeout(250); };

(async () => {
  const browser = await chromium.launch();
  // 1. BM masuk pertama kali -> data awal
  const bm = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  await bm.waitForSelector('#lgForm');
  await login(bm, 'nadia', '1357');
  ok(await bm.isVisible('text=Username atau PIN salah'), 'PIN salah ditolak');
  await login(bm, 'nadia', '2468');
  await bm.waitForTimeout(1200);
  const recs = [...DB.recs.values()];
  ok(recs.filter(r => r.coll === 'outlets').length === 17, 'seed 17 outlet nyata (outlets=' + recs.filter(r => r.coll === 'outlets').length + ')');
  ok(recs.filter(r => r.coll === 'visits').length === 0, 'tanpa kunjungan demo');
  ok(!(await bm.innerText('body')).includes('Demo —'), 'tidak ada outlet demo di layar');
  await bm.waitForSelector('text=Tersinkron',{timeout:15000}).catch(()=>{});
  ok(await bm.isVisible('text=Tersinkron'), 'status Tersinkron tampil');
  await bm.screenshot({ path: SHOT + '/1-bm-home.png' });
  // Tim -> buat akun Dimas
  await bm.evaluate(() => { const b = [...document.querySelectorAll('[data-act="go"]')].find(x => x.dataset.v === 'pengaturan'); b && b.click(); });
  await bm.waitForTimeout(300);
  await bm.evaluate(() => { const b = [...document.querySelectorAll('[data-act]')].find(x => /^Tim/.test(x.textContent.trim()) && x.dataset.act !== 'go'); b && b.click(); });
  await bm.waitForTimeout(300);
  ok(await bm.isVisible('text=Akun login'), 'kartu Akun login tampil di Tim');
  await click(bm, '[data-act="laccOpen"][data-id="dimas"]');
  await bm.fill('#lacc-un', 'dimas'); await bm.fill('#lacc-pin', '58139');
  await click(bm, '[data-act="laccGo"]'); await bm.waitForTimeout(600);
  ok(DB.profiles.find(p => p.app_id === 'dimas').user_id === 'u-dimas' && DB.pins.dimas.pin === '5813', 'akun Dimas dibuat (username+PIN 4 digit, input dipotong 4)');
  await bm.screenshot({ path: SHOT + '/2-bm-tim.png', fullPage: true });

  // 2. MD di HP
  const md = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await md.waitForSelector('#lgForm'); await md.screenshot({ path: SHOT + '/3-login-hp.png' });
  await md.click('#lgMode'); ok(await md.isVisible('#lgEmail'), 'opsi email (Pemilik) tersedia'); await md.click('#lgMode');
  await login(md, 'dimas', '5813'); await md.waitForTimeout(800);
  ok(await md.isVisible('text=Halo') || (await md.content()).includes('Dimas'), 'MD masuk');
  await md.screenshot({ path: SHOT + '/4-md-home.png' });
  // mulai cek toko FoodHall Plaza Indonesia (o3, koordinat -6.19080,106.82200)
  const started = await md.evaluate(c => window.__AF(c), "(function(){ UI.wiz = newWiz('o3'); render(); return !!UI.wiz; })()");
  ok(started, 'wizard cek toko dibuka');
  ok((await md.content()).includes('Lokasi GPS'), 'kartu GPS asli (bukan simulasi)');
  await md.click('[data-act="wphoto"][data-k="before"]'); await md.waitForTimeout(1500);
  const w1 = await md.evaluate(c => window.__AF(c), '({ p: UI.wiz.photos.before, f: UI.wiz.photoFiles && UI.wiz.photoFiles.before, g: UI.wiz.gpsAt && UI.wiz.gpsAt.before })');
  ok(!!w1.p && !!w1.f && w1.g != null && w1.g < 50, 'foto sebelum + GPS ' + JSON.stringify(w1));
  await md.screenshot({ path: SHOT + '/5-md-foto.png', fullPage: true });
  // isi cepat langkah 2-5
  await md.evaluate(c => window.__AF(c), "(function(){ var w = UI.wiz; SKUS.forEach(function(s){ Object.assign(w.items[s.sku], { stok: 'Ada', qty: 10, gudang: 'Ada', gudangQty: 5, harga: 'Sesuai', exp: 'Tidak' }) }); w.std = { rapi: 'Ya', posisi: 'Ya', fifo: 'Ya', label: 'Ya' }; w.posm = 'Terpasang'; w.lokasi = 'Chiller'; w.simpan = 'Dingin'; w.tindakan = ['Rapikan rak']; w.restockAsk = 'Tidak'; w.step = 5; w.ts.before -= 9 * 60000; render(); })()");
  await md.click('[data-act="wphoto"][data-k="after"]'); await md.waitForTimeout(1200);
  await md.click('[data-act="wphoto"][data-k="challenge"]'); await md.waitForTimeout(1200);
  const miss = await md.evaluate(c => window.__AF(c), 'wizMissing(UI.wiz, 5)');
  ok(miss.length === 0, 'langkah 5 lengkap ' + JSON.stringify(miss));
  await md.screenshot({ path: SHOT + '/6-md-step5.png', fullPage: true });
  await md.evaluate(c => window.__AF(c), 'submitVisit(user(S.me))'); await md.waitForTimeout(1200);
  const v = [...DB.recs.values()].find(r => r.coll === 'visits');
  ok(!!v && v.data.gps != null && v.data.gps < 50 && v.data.dur >= 9 && v.data.photoFiles && v.data.photoFiles.before, 'kunjungan tersimpan di server ' + (v && JSON.stringify({ gps: v.data.gps, dur: v.data.dur, md: v.data.md })));
  ok(DB.uploads.length >= 3 && DB.uploads.every(p => p.startsWith('u-dimas/')), 'foto terunggah ke folder MD (' + DB.uploads.length + ')');
  // 3. BM melihat laporan masuk realtime
  await bm.waitForTimeout(1200);
  const bmSees = await bm.evaluate(c => window.__AF(c), 'S.visits.length');
  ok(bmSees === 1, 'BM menerima laporan realtime (visits=' + bmSees + ')');
  await bm.evaluate(c => window.__AF(c), "(function(){ UI.view = 'feed'; render(); })()"); await bm.waitForTimeout(500);
  await bm.screenshot({ path: SHOT + '/7-bm-feed.png', fullPage: true });
  // 4. MD tidak bisa mengubah master data
  await md.evaluate(c => window.__AF(c), "(function(){ S.outlets[0].nama = 'DIUBAH MD'; save(); })()"); await md.waitForTimeout(800);
  ok(!JSON.stringify([...DB.recs.values()].filter(r => r.coll === 'outlets')).includes('DIUBAH MD'), 'perubahan outlet oleh MD tidak sampai server');
  // 5. Offline: MD buat izin saat offline, terkirim saat online
  OFFLINE.add(md); await md.context().setOffline(true);
  await md.evaluate(c => window.__AF(c), "(function(){ S.excuses.push({ id: 'E' + rid(), user: S.me, date: TODAY, alasan: 'Sakit', catatan: 'tes offline', status: 'Menunggu' }); save(); })()"); await md.waitForTimeout(800);
  const pend = await md.evaluate(c => window.__AF(c), 'OUTBOX.length');
  ok(pend >= 1 && ![...DB.recs.values()].some(r => r.coll === 'excuses'), 'offline: tersimpan di HP (' + pend + ' antre)');
  await md.screenshot({ path: SHOT + '/8-md-offline.png' });
  OFFLINE.delete(md); await md.context().setOffline(false); await md.evaluate(c => window.__AF(c), '(function(){ NET.err = null; flush(); })()'); await md.waitForTimeout(1200);
  ok([...DB.recs.values()].some(r => r.coll === 'excuses'), 'online lagi: antrean terkirim');
  // 6. muat ulang MD -> data dari server, sesi tetap
  await md.reload(); await md.waitForTimeout(1500);
  ok(await md.evaluate(c => window.__AF(c), "S && S.visits.length === 1 && S.me === 'dimas'"), 'reload: sesi & data tetap');
  // 7. SPG absen selfie + GPS
  DB.profiles.find(p=>p.app_id==='sari').user_id='u-sari';DB.profiles.find(p=>p.app_id==='sari').username='sari';DB.pins.sari={pin:'7531'};
  const spg = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: -6.19525, longitude: 106.81885, accuracy: 15 } });
  await spg.waitForSelector('#lgForm'); await login(spg, 'sari', '7531'); await spg.waitForTimeout(800);
  await spg.click('[data-act="absenMasuk"]'); await spg.waitForTimeout(1500);
  const sd=[...DB.recs.values()].find(r=>r.coll==='spgDays');
  ok(!!sd && sd.data.gps!=null && sd.data.gps<50 && sd.data.photoFiles && sd.data.photoFiles.selfie, 'SPG absen selfie+GPS '+(sd&&JSON.stringify({gps:sd.data.gps,masuk:sd.data.masuk})));
  await spg.screenshot({ path: SHOT + '/9-spg.png', fullPage: true });
  console.log('errors spg:', spg.errs.filter(e=>!/fetching the script/.test(e)).slice(0,5));
  // 8. Hapus pegawai nonaktif: tanpa riwayat boleh, dengan riwayat tidak
  const r8 = await bm.evaluate(c => window.__AF(c), "(function(){ var y=user('yoga'); y.aktif=false; y.keluar=TODAY; var d=user('dimas'); var hd=userHist('dimas'); var hy=userHist('yoga'); save(); return {hd:hd,hy:hy}; })()");
  await bm.waitForTimeout(600);
  await bm.evaluate(c => window.__AF(c), "(function(){ UI.view='pengaturan'; render(); })()");
  await bm.evaluate(() => { const b = [...document.querySelectorAll('[data-act]')].find(x => /^Tim/.test(x.textContent.trim()) && x.dataset.act !== 'go'); b && b.click(); });
  await bm.waitForTimeout(300); await bm.evaluate(() => { const d=document.querySelector('details[data-det="timoff"]'); if(d) d.open=true; });
  await bm.click('[data-act="udelAsk"][data-id="yoga"]'); await bm.waitForTimeout(200);
  await bm.screenshot({ path: SHOT + '/10-hapus.png', fullPage: true });
  await bm.click('[data-act="udelGo"][data-id="yoga"]'); await bm.waitForTimeout(900);
  ok(r8.hd > 0 && r8.hy === 0, 'riwayat terdeteksi ' + JSON.stringify(r8));
  ok(!DB.profiles.some(p => p.app_id === 'yoga') && DB.recs.get('users|yoga').deleted, 'pegawai tanpa riwayat terhapus (profil & daftar)');
  // 9. Sesi hilang: perubahan TIDAK dibuang, minta login ulang, lalu terkirim
  await bm.evaluate(c => window.__AF(c), "(function(){ localStorage.setItem('__tok_bak', localStorage.getItem('mock-tok')); localStorage.removeItem('mock-tok'); S.outlets[0].alamat='Tes sesi hilang'; save(); })()");
  await bm.waitForTimeout(900);
  const lost = await bm.evaluate(c => window.__AF(c), "({ob: OUTBOX.length, login: !!document.getElementById('lgForm')})");
  ok(lost.ob >= 1 && lost.login, 'sesi hilang: perubahan tetap di antrean & diminta login ulang ' + JSON.stringify(lost));
  await login(bm, 'nadia', '2468'); await bm.waitForTimeout(1500);
  ok(JSON.stringify(DB.recs.get('outlets|o1').data).includes('Tes sesi hilang'), 'setelah login ulang, perubahan terkirim');
  // 10. Sabtu tentatif
  const sat = await bm.evaluate(c => window.__AF(c), "(function(){ var s=addDays(TODAY,1); while(dowOf(s)!==6) s=addDays(s,1); var u=user('dimas'); var a=mdDay(u,s).status; var nx=nextWorkday(addDays(s,-1)); S.plans['dimas|'+s]={outlets:['o1','o2'],ovr:true,by:'BM'}; var b=isWorkFor('dimas',s); var t=targetOf(u,s); var c2=isWorkFor('bagas',s); var chips=planDates(7).some(isSat); delete S.plans['dimas|'+s]; return {sat:s,tanpaRute:a,nextWork:dowOf(nx),denganRute:b,target:t,lain:c2,chip:chips}; })()");
  ok(sat.tanpaRute==='nanti'||sat.tanpaRute==='libur', 'Sabtu tanpa rute bukan hari kerja '+JSON.stringify(sat));
  ok(sat.nextWork===1 && sat.denganRute && sat.target===2 && !sat.lain && sat.chip, 'Sabtu dengan rute khusus = masuk kerja (hanya orang itu); Senin = hari kerja berikutnya');
  console.log('errors bm:', bm.errs.slice(0, 5)); console.log('errors md:', md.errs.slice(0, 5));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
