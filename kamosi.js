// =====================================================
// KAMOŠI WIDGET – Scriptable (beží u kamošov)
//
// Kamoš vidí Ivanove fotky. Čím dlhšie sa Ivanovi neozval,
// tým horšia stage (fotky aj texty).
//
// Fotky a nastavenia sú vo verejnom GitHub repe:
//   stage1/      pekné fotky                (0–4 dni)
//   stage2/      divnejšie                  (5–8 dní)
//   stage3/      apokalypsa                 (9+ dní)
//   config.json  meno, Instagram, texty (voliteľné)
//
// Ťuk na widget: tá istá fotka na celú obrazovku + 2 tlačidlá
//   "We were chatting" -> vynuluje počítadlo
//   "Let's catch up"   -> otvorí Instagram DM s Ivanom
// =====================================================

// ===== NASTAVENIE – vyplní Ivan pred poslaním kamošom =====
const GITHUB_USER = "Pohyy"
const GITHUB_REPO = "kamosi-widget"
const BRANCH = "main"
// ==========================================================

const DEFAULTS = {
  name: "Ivan",
  instagram: "",
  limits: [4, 8], // stage1 do 4 dní, stage2 do 8 dní, potom stage3
  texts: {
    stage1: [
      "{name} ťa má rád 🫶",
      "Ty a {name}: všetko ok 👌",
      "{name} je spokojný. Zatiaľ.",
    ],
    stage2: [
      "{name} sa pýta, či ešte žiješ 👀",
      "{name} si začína hľadať nových kamošov",
      "{name} čaká na správu už {d}.",
      "Napíš. Teraz. 📱",
    ],
    stage3: [
      "🚨 {d} ticho. {name} trpí. 🚨",
      "{name} už o tebe rozpráva v minulom čase",
      "{name} ťa vyškrtol z vianočného zoznamu",
      "{d}. Toto je tvoja vina.",
      "{name} sa rozpadá. Ozvi sa HNEĎ.",
    ],
  },
}

const IMG = /\.(jpe?g|png|heic)$/i
const RAW = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${BRANCH}`
const API = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents`

// ---------- lokálne úložisko (na telefóne kamoša) ----------
const fm = FileManager.local()
const dir = fm.joinPath(fm.documentsDirectory(), "kamosi-widget")
if (!fm.fileExists(dir)) fm.createDirectory(dir, true)
const P = n => fm.joinPath(dir, n)

function readJSON(n, fallback) {
  if (!fm.fileExists(P(n))) return fallback
  try { return JSON.parse(fm.readString(P(n))) } catch (e) { return fallback }
}
function writeJSON(n, v) { fm.writeString(P(n), JSON.stringify(v)) }

// ---------- dátumy ----------
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function today() { return isoDate(new Date()) }
function daysSince(iso) {
  const then = new Date(iso + "T00:00:00")
  const now = new Date(); now.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((now - then) / 86400000))
}
function dni(n) {
  if (n === 0) return "dnes"
  if (n === 1) return "1 deň"
  if (n >= 2 && n <= 4) return `${n} dni`
  return `${n} dní`
}

// ---------- pomocné ----------
function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null }
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
function stageFor(days, cfg) {
  const [a, b] = cfg.limits
  return days <= a ? "stage1" : days <= b ? "stage2" : "stage3"
}
function fill(tpl, cfg, d) {
  return tpl.replaceAll("{name}", cfg.name).replaceAll("{d}", dni(d))
}
function randomText(cfg, stage, d) {
  const list = (cfg.texts[stage] && cfg.texts[stage].length) ? cfg.texts[stage] : DEFAULTS.texts[stage]
  return fill(pick(list), cfg, d)
}

// zmenší fotku; darken = stmaví spodok kvôli textu vo widgete
function resize(img, maxW, darken) {
  const s = img.size
  const scale = Math.min(1, maxW / s.width)
  const w = s.width * scale, h = s.height * scale
  const ctx = new DrawContext()
  ctx.size = new Size(w, h)
  ctx.respectScreenScale = false
  ctx.drawImageInRect(img, new Rect(0, 0, w, h))
  if (darken) {
    ctx.setFillColor(new Color("#000000", 0.25))
    ctx.fillRect(new Rect(0, h * 0.45, w, h * 0.55))
    ctx.setFillColor(new Color("#000000", 0.25))
    ctx.fillRect(new Rect(0, h * 0.7, w, h * 0.3))
  }
  return ctx.getImage()
}

// ---------- GitHub ----------
async function fetchJSON(url) {
  const r = new Request(url)
  r.headers = { "User-Agent": "kamosi-widget", "Accept": "application/vnd.github+json" }
  r.timeoutInterval = 20
  return await r.loadJSON()
}

async function loadConfig() {
  let remote = null
  try {
    const res = await fetchJSON(`${RAW}/config.json?t=${Date.now()}`)
    if (res && typeof res === "object" && !Array.isArray(res)) {
      remote = res
      writeJSON("config-cache.json", res)
    }
  } catch (e) {}
  if (!remote) remote = readJSON("config-cache.json", {})
  return {
    ...DEFAULTS,
    ...remote,
    texts: { ...DEFAULTS.texts, ...(remote.texts || {}) },
    limits: Array.isArray(remote.limits) && remote.limits.length === 2 ? remote.limits : DEFAULTS.limits,
  }
}

// zoznam súborov v stage priečinku (pri výpadku siete z cache)
async function listStage(folder) {
  try {
    const res = await fetchJSON(`${API}/${folder}?ref=${BRANCH}`)
    if (Array.isArray(res)) {
      const files = res.filter(f => f.type === "file").map(f => ({ name: f.name, url: f.download_url }))
      writeJSON(`list-${folder}.json`, files)
      return files
    }
  } catch (e) {}
  return readJSON(`list-${folder}.json`, [])
}

// ---------- widget ----------
async function buildWidget(cfg, state) {
  const w = new ListWidget()
  w.backgroundColor = new Color("#1c1c1e")
  w.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000) // každú hodinu nová fotka

  const d = daysSince(state.last)
  const stage = stageFor(d, cfg)
  const photos = (await listStage(stage)).filter(f => IMG.test(f.name))
  const cachePath = P(`widget-${stage}.jpg`)

  let bg = null
  let photoUrl = ""
  const f = pick(photos)
  if (f) {
    try {
      const img = await new Request(f.url).loadImage()
      bg = resize(img, 700, true)
      fm.writeImage(cachePath, bg)
      photoUrl = f.url
    } catch (e) {}
  }
  if (!bg && fm.fileExists(cachePath)) bg = fm.readImage(cachePath)
  if (bg) w.backgroundImage = bg

  const text = randomText(cfg, stage, d)
  w.url = `${URLScheme.forRunningScript()}?open=1&photo=${encodeURIComponent(photoUrl)}&text=${encodeURIComponent(text)}`

  w.addSpacer()

  const t = w.addText(text)
  t.textColor = Color.white()
  t.font = Font.heavySystemFont(16)
  t.minimumScaleFactor = 0.6
  t.lineLimit = 3
  t.shadowColor = Color.black()
  t.shadowRadius = 4

  const sub = w.addText(d === 0 ? `s ${cfg.name} dnes ✅` : `posledný kontakt: ${dni(d)}`)
  sub.textColor = new Color("#ffffff", 0.8)
  sub.font = Font.mediumSystemFont(11)
  sub.shadowColor = Color.black()
  sub.shadowRadius = 3

  return w
}

// ---------- celá obrazovka ----------
function sleep(ms) { return new Promise(r => Timer.schedule(ms, false, r)) }

async function fullscreen(cfg, state, params) {
  // po ťuknutí na widget sa Scriptable ešte len spúšťa – chvíľu počkáme,
  // inak sa obrazovka nemusí zobraziť (čierna obrazovka)
  if (params.open) await sleep(800)
  const d = daysSince(state.last)
  const stage = stageFor(d, cfg)
  const text = params.text || randomText(cfg, stage, d)
  let media = ""
  let url = params.photo
  if (!url) {
    const photos = (await listStage(stage)).filter(f => IMG.test(f.name))
    url = (pick(photos) || {}).url
  }
  const cachePath = P(`widget-${stage}.jpg`)
  if (url) {
    // fotku načíta priamo WebView z GitHubu (bez veľkého base64 v HTML)
    media = `<img class="m" src="${esc(url)}">`
  } else if (fm.fileExists(cachePath)) {
    media = `<img class="m" src="data:image/jpeg;base64,${Data.fromJPEG(fm.readImage(cachePath)).toBase64String()}">`
  }

  const showIg = !!(cfg.instagram || "").trim()

  const html = `<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:#111;color:#fff;font-family:-apple-system,system-ui,sans-serif}
.m{position:fixed;inset:0;width:100%;height:100%;object-fit:cover}
.shade{position:fixed;inset:0;pointer-events:none;background:linear-gradient(to bottom,rgba(0,0,0,0) 35%,rgba(0,0,0,.9) 100%)}
.box{position:fixed;left:0;right:0;bottom:0;padding:24px 20px calc(28px + env(safe-area-inset-bottom))}
h1{font-size:26px;font-weight:800;margin-bottom:6px;line-height:1.2}
small{display:block;font-size:14px;opacity:.75;margin-bottom:20px}
button{display:block;width:100%;padding:17px;border:0;border-radius:14px;font-size:17px;font-weight:700;margin-top:10px}
#chat{background:#fff;color:#000}
#ig{background:linear-gradient(45deg,#f58529,#dd2a7b,#8134af);color:#fff}
#done{display:none;text-align:center;font-size:18px;font-weight:700;padding:16px 0}
</style></head><body>
${media}
<div class="shade"></div>
<div class="box">
  <h1>${esc(text)}</h1>
  <small>${d === 0 ? "s " + esc(cfg.name) + " ste v kontakte dnes" : "posledný kontakt s " + esc(cfg.name) + ": " + esc(dni(d))}</small>
  <div id="btns">
    <button id="chat">We were chatting ✅</button>
    ${showIg ? `<button id="ig">Let's catch up 💬</button>` : ""}
  </div>
  <div id="done">✅ Uložené – zavri potiahnutím dole</div>
</div>
</body></html>`

  const wv = new WebView()
  await wv.loadHTML(html)
  const closed = wv.present(true).then(() => "closed")
  const clicked = wv.evaluateJavaScript(`
    document.getElementById('chat').onclick = function(){ completion('chat') };
    var ig = document.getElementById('ig');
    if (ig) ig.onclick = function(){ completion('ig') };
    null;
  `, true)
  const choice = await Promise.race([clicked, closed])

  if (choice === "chat") {
    state.last = today()
    writeJSON("state.json", state)
    await wv.evaluateJavaScript(`
      document.getElementById('btns').style.display='none';
      document.getElementById('done').style.display='block';
      null;
    `)
    await closed
  } else if (choice === "ig") {
    const ig = cfg.instagram.trim().replace(/^@/, "")
    Safari.open(`https://ig.me/m/${encodeURIComponent(ig)}`)
  }
}

// ---------- spustenie ----------
const cfg = await loadConfig()
const state = readJSON("state.json", null) || { last: today() }
writeJSON("state.json", state)

if (config.runsInWidget) {
  Script.setWidget(await buildWidget(cfg, state))
} else {
  try {
    await fullscreen(cfg, state, args.queryParameters || {})
  } catch (e) {
    const a = new Alert()
    a.title = "Chyba"
    a.message = String(e)
    a.addAction("OK")
    await a.presentAlert()
  }
}

Script.complete()
