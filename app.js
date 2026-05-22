/* ============================================================
   FUT RAIZ - Versao online (Supabase + Vercel)
   ============================================================ */

const LINE_ATTRS = ['FINA','COLETIVO','DEFESA','DRIBLE','FORCA','PASSE','VELO','VIGOR','PNR'];
const GK_ATTRS   = ['BASE','CHU. LG','IMPULSO','LANCA','PASSE. LG','REFLEXO','POSICIO.'];

let supa = null;
let session = null;
let me = null;
let cache = { players:[], evaluations:[], profiles:[], rounds:[], settings:{}, matches:[], matchStats:[] };
let currentTab = 'avaliar';
let filterRole = 'TODOS';
let searchTxt = '';
let rankingAttr = 'TODOS';
let viewingUserId = null;
let saveStatus = 'idle'; // 'idle' | 'saving' | 'saved' | 'error'
let pendingSaves = 0;    // contador de saves pendentes
let matchSearchTxt = '';  // busca de jogador na partida

/* Limites: tudo 60-99, PNR vai 0-5 */
function attrMin(a){ return a==='PNR' ? 0 : 60; }
function attrMax(a){ return a==='PNR' ? 5 : 99; }
function clampAttr(a, n){ return Math.max(attrMin(a), Math.min(attrMax(a), n)); }

/* ---------- INIT ---------- */
async function init(){
  const URL = window.SUPABASE_URL || '';
  const KEY = window.SUPABASE_ANON_KEY || '';
  if(URL.includes('COLE_SUA') || KEY.includes('COLE_SUA')){
    document.getElementById('app').innerHTML = '<div class="config-warn"><h2>&#9888; Configuracao pendente</h2><p>Edite o <code>index.html</code> e substitua <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> pelos valores do seu Supabase. Veja README passo 3.</p></div>';
    return;
  }
  supa = window.supabase.createClient(URL, KEY, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      storage: window.localStorage
    }
  });
  // Se voltou do OAuth com code/hash, aguarda processar antes de renderizar
  if (window.location.search.includes('code=') || window.location.hash.includes('access_token')) {
    await new Promise(r => setTimeout(r, 1200));
  }
  const { data:{ session: s } } = await supa.auth.getSession();
  await onAuthChange(s);
  supa.auth.onAuthStateChange(async (_, s) => { await onAuthChange(s); });
}

async function onAuthChange(s){
  session = s;
  if(!session){
    me = null;
    document.getElementById('hdr').style.display='none';
    document.getElementById('tabs').style.display='none';
    document.getElementById('app').innerHTML = renderLogin();
    return;
  }
  await loadProfile();
  if(!me){
    document.getElementById('app').innerHTML = '<div class="card"><div class="empty">Erro ao carregar perfil. Recarregue.</div></div>';
    return;
  }
  await loadAll();
  render();           // render PRIMEIRO (não bloqueia se realtime falhar)
  setupRealtime();    // depois tenta realtime
}

async function loadProfile(){
  const { data, error } = await supa.from('profiles').select('*').eq('id', session.user.id).single();
  if(error){ console.error(error); me=null; return; }
  me = data;
}

async function loadAll(){
  document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><div>Carregando dados...</div></div>';
  const [players, evals, profiles, rounds, settings, matches, mstats] = await Promise.all([
    supa.from('players').select('*').order('name'),
    supa.from('evaluations').select('*'),
    supa.from('profiles').select('*').order('name'),
    supa.from('rounds').select('*').order('closed_at', {ascending:true}),
    supa.from('settings').select('*'),
    supa.from('matches').select('*').order('created_at', {ascending:false}),
    supa.from('match_stats').select('*'),
  ]);
  cache.players = players.data || [];
  cache.evaluations = evals.data || [];
  cache.profiles = profiles.data || [];
  cache.rounds = rounds.data || [];
  cache.settings = {};
  (settings.data||[]).forEach(s => cache.settings[s.key] = s.value);
  cache.matches = matches.data || [];
  cache.matchStats = mstats.data || [];
}

let realtimeReady = false;
function setupRealtime(){
  if(realtimeReady) return;  // evita subscrição duplicada
  realtimeReady = true;
  try {
    supa.channel('public-changes').on('postgres_changes', {event:'*', schema:'public'}, async () => {
      await loadAll(); render();
    }).subscribe();
  } catch(e){ console.warn('realtime setup failed (não-bloqueante)', e); }
}

/* ---------- AUTH ---------- */
async function signInGoogle(){
  const { error } = await supa.auth.signInWithOAuth({
    provider:'google',
    options:{ redirectTo: window.location.origin + window.location.pathname }
  });
  if(error) toast('Erro ao entrar: '+error.message, 'bad');
}
async function signOut(){ await supa.auth.signOut(); }
function isAdmin(){ return !!(me && me.is_admin); }

/* ---------- HELPERS ---------- */
function roleEmoji(r){ return r==='ATACANTE'?'⚔️':r==='DEFENSOR'?'🛡️':'🥅'; }
function defaultRound(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function currentRound(){ return cache.settings.current_round || defaultRound(); }

function getMyEval(playerId, attr){
  if(!me) return undefined;
  const e = cache.evaluations.find(x => x.user_id===me.id && x.player_id===playerId && x.attr===attr);
  return e ? e.value : undefined;
}
function avgEval(playerId, attr){
  const vs = cache.evaluations.filter(x => x.player_id===playerId && x.attr===attr).map(x => x.value);
  if(vs.length===0) return null;
  return Math.round(vs.reduce((s,v)=>s+v,0)/vs.length);
}
function avgOverall(player){
  const list = (player.role==='GOLEIRO') ? GK_ATTRS : LINE_ATTRS.filter(a=>a!=='PNR');
  let s=0,n=0;
  list.forEach(a=>{ const v=avgEval(player.id,a); if(typeof v==='number'){s+=v;n++;}});
  return n>0 ? Math.round(s/n) : null;
}
function evalCount(playerId){
  return new Set(cache.evaluations.filter(x=>x.player_id===playerId).map(x=>x.user_id)).size;
}
function lastSnapshot(){ return cache.rounds.length ? cache.rounds[cache.rounds.length-1] : null; }
function arrow(curr, prev){
  if(curr==null||prev==null) return '';
  if(curr>prev) return '<span class="arrow-up">&#9650;'+(curr-prev)+'</span>';
  if(curr<prev) return '<span class="arrow-dn">&#9660;'+(prev-curr)+'</span>';
  return '<span class="arrow-eq">&#9644;</span>';
}

/* ---------- ESCRITAS ---------- */
const evalTimers = {};
function setSaveStatus(s){
  saveStatus = s;
  const el = document.getElementById('saveStatus');
  if(el){
    const map = {idle:'', saving:'⏳ Salvando...', saved:'✓ Salvo', error:'✗ Erro ao salvar'};
    el.textContent = map[s] || '';
    el.className = 'save-status ' + s;
  }
}
async function persistEval(playerId, attr, val){
  pendingSaves++;
  setSaveStatus('saving');
  try {
    if(val==null){
      await supa.from('evaluations').delete().match({user_id: me.id, player_id: playerId, attr});
      cache.evaluations = cache.evaluations.filter(x => !(x.user_id===me.id && x.player_id===playerId && x.attr===attr));
    } else {
      const { error } = await supa.from('evaluations').upsert({user_id: me.id, player_id: playerId, attr, value: val});
      if(error){ setSaveStatus('error'); toast('Erro: '+error.message, 'bad'); return; }
      const i = cache.evaluations.findIndex(x => x.user_id===me.id && x.player_id===playerId && x.attr===attr);
      if(i>=0) cache.evaluations[i].value = val;
      else cache.evaluations.push({user_id: me.id, player_id: playerId, attr, value: val});
    }
  } catch(e){ setSaveStatus('error'); toast('Erro: '+e.message, 'bad'); return; }
  finally {
    pendingSaves--;
    if(pendingSaves===0) setSaveStatus('saved');
  }
}
async function saveAllPending(){
  // força flush de todos os timers de debounce
  Object.keys(evalTimers).forEach(k => {
    if(evalTimers[k]){ clearTimeout(evalTimers[k]); }
  });
  // dispara save de cada input atual da tela
  setSaveStatus('saving');
  const inputs = document.querySelectorAll('input.rate-input');
  for(const inp of inputs){
    const ph = inp.getAttribute('data-pid'), at = inp.getAttribute('data-attr');
    if(ph && at){
      const raw = inp.value;
      if(raw==='' || raw==null) await persistEval(ph, at, null);
      else { const n = parseInt(raw,10); if(!isNaN(n)) await persistEval(ph, at, clampAttr(at, n)); }
    }
  }
  toast('Tudo salvo!', 'good');
}
function setEval(playerId, attr, raw){
  const n = parseInt(raw,10);
  const key = playerId+'_'+attr;
  clearTimeout(evalTimers[key]);
  evalTimers[key] = setTimeout(() => {
    if(isNaN(n) || raw==='') persistEval(playerId, attr, null);
    else if(n >= attrMin(attr) && n <= attrMax(attr)) persistEval(playerId, attr, n);
  }, 400);
}
function snapEval(playerId, attr, inputEl){
  const raw = inputEl.value;
  if(raw==='' || raw==null){ persistEval(playerId, attr, null); return; }
  const n = parseInt(raw,10);
  if(isNaN(n)){ inputEl.value=''; persistEval(playerId, attr, null); return; }
  const c = clampAttr(attr, n);
  if(c!==n){
    inputEl.value = c;
    toast('Ajustado para '+c+' (limite '+attrMin(attr)+'-'+attrMax(attr)+')', 'good');
  }
  persistEval(playerId, attr, c);
}

async function addPlayer(){
  const name = document.getElementById('newPName').value.trim();
  const role = document.getElementById('newPRole').value;
  if(!name) return toast('Coloque um nome.', 'bad');
  const { error } = await supa.from('players').insert({name, role});
  if(error) return toast('Erro: '+error.message, 'bad');
  await loadAll(); render(); toast('Jogador "'+name+'" adicionado.', 'good');
}
async function removePlayer(id){
  if(!confirm('Remover esse jogador? Apaga as avaliacoes dele tambem.')) return;
  const { error } = await supa.from('players').delete().eq('id', id);
  if(error) return toast('Erro: '+error.message, 'bad');
  await loadAll(); render();
}
async function changeRole(id, role){
  const { error } = await supa.from('players').update({role}).eq('id', id);
  if(error) return toast('Erro: '+error.message, 'bad');
  await loadAll(); render();
}
async function promote(userId, name){
  const { error } = await supa.from('profiles').update({is_admin:true}).eq('id', userId);
  if(error) return toast('Erro: '+error.message, 'bad');
  await loadAll(); render(); toast(name+' agora e admin.', 'good');
}
async function demote(userId, name){
  const { error } = await supa.from('profiles').update({is_admin:false}).eq('id', userId);
  if(error) return toast('Erro: '+error.message, 'bad');
  await loadAll(); render(); toast(name+' foi rebaixado.');
}
async function removeUser(userId, name){
  if(!confirm('Remover o membro "'+name+'"? Todos os votos dele(a) tambem serao removidos e a media recalculada sem essas notas.')) return;
  await supa.from('evaluations').delete().eq('user_id', userId);
  await supa.from('profiles').delete().eq('id', userId);
  await loadAll(); render();
  toast('"'+name+'" removido. Medias atualizadas.', 'good');
}

async function gravarRodada(){
  if(!isAdmin()) return;
  const round = currentRound();
  if(!confirm('Encerrar a rodada '+round+'? Isso vira o novo ponto de comparacao das setas e avanca pra proxima rodada.')) return;
  const averages = {};
  cache.players.forEach(p => {
    const attrs = (p.role==='GOLEIRO') ? GK_ATTRS : LINE_ATTRS;
    averages[p.id] = {};
    attrs.forEach(a => { const v = avgEval(p.id, a); if(v!=null) averages[p.id][a] = v; });
    const ov = avgOverall(p); if(ov!=null) averages[p.id].OVERALL = ov;
  });
  const ins = await supa.from('rounds').insert({round_label: round, averages});
  if(ins.error){ return toast('Erro: '+ins.error.message, 'bad'); }
  const del = await supa.from('evaluations').delete().neq('attr','__nunca__');
  if(del.error){ return toast('Erro ao limpar: '+del.error.message, 'bad'); }
  const parts = round.split('-');
  const nd = new Date(parseInt(parts[0]), parseInt(parts[1]), 1);
  const next = nd.getFullYear()+'-'+String(nd.getMonth()+1).padStart(2,'0');
  await supa.from('settings').upsert({key:'current_round', value: JSON.stringify(next)});
  await loadAll(); render();
  toast('Rodada encerrada. Nova rodada: '+next, 'good');
}

/* ---------- RENDER ---------- */
function setTab(t){ currentTab=t; render(); }

function render(){
  // Preserva foco antes do re-render
  const ae = document.activeElement;
  let focusInfo = null;
  if(ae && ae.tagName==='INPUT'){
    focusInfo = {
      isSearch: ae.classList.contains('search'),
      isRate: ae.classList.contains('rate-input'),
      placeholder: ae.placeholder || '',
      pid: ae.getAttribute('data-pid'),
      attr: ae.getAttribute('data-attr'),
      selStart: ae.selectionStart,
      selEnd: ae.selectionEnd
    };
  }

  document.getElementById('hdr').style.display='flex';
  document.getElementById('tabs').style.display='flex';
  document.getElementById('meName').textContent = me.name;
  document.getElementById('meAvatar').src = me.avatar_url || '';
  document.getElementById('meAvatar').style.display = me.avatar_url ? 'block' : 'none';
  document.getElementById('meAdm').style.display = isAdmin() ? 'inline-block' : 'none';
  document.getElementById('roundLbl').textContent = 'Rodada: '+currentRound();
  renderTabs();
  const fn = {avaliar:renderAvaliar, dashboard:renderDashboard, score:renderScore, ranks:renderRanksIndividuais, jogadores:renderJogadores, membros:renderMembros, historico:renderHistorico}[currentTab] || renderAvaliar;
  document.getElementById('app').innerHTML = fn();

  // Restaura foco após render
  if(focusInfo){
    setTimeout(() => {
      let target = null;
      if(focusInfo.isRate && focusInfo.pid && focusInfo.attr){
        target = document.querySelector('input[data-pid="'+focusInfo.pid+'"][data-attr="'+focusInfo.attr+'"]');
      } else if(focusInfo.isSearch){
        target = Array.from(document.querySelectorAll('input.search')).find(i => i.placeholder === focusInfo.placeholder);
      }
      if(target){
        target.focus();
        try { target.setSelectionRange(focusInfo.selStart, focusInfo.selEnd); } catch(e){}
      }
    }, 0);
  }
}

function renderTabs(){
  const tabs = [
    {id:'avaliar', label:'📝 Minha Avaliação'},
    {id:'dashboard', label:'📊 Dashboard'},
    {id:'score', label:'⚽ Score dos Futs'},
  ];
  if(isAdmin()){
    tabs.push({id:'ranks', label:'👁️ Ranks Individuais'});
    tabs.push({id:'jogadores', label:'👥 Jogadores'});
    tabs.push({id:'membros', label:'⚙️ Membros'});
    tabs.push({id:'historico', label:'🕓 Histórico'});
  }
  document.getElementById('tabs').innerHTML = tabs.map(t =>
    '<button class="'+(currentTab===t.id?'active':'')+'" onclick="setTab(\''+t.id+'\')">'+t.label+'</button>'
  ).join('');
}

function renderLogin(){
  return '<div class="login-wrap"><div class="card">'+
    '<h1>⚽ Fut Raíz</h1>'+
    '<p>Entre com sua conta Google pra começar a avaliar.</p>'+
    '<button class="btn google" onclick="signInGoogle()">'+
      '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2L31.2 33c-2 1.4-4.5 2.2-7.2 2.2-5.3 0-9.7-3.4-11.3-8L6 32.2C9.4 38.7 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.1 4-3.9 5.3l6.2 5.2C42.6 35.3 44 30 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>'+
      'Entrar com Google'+
    '</button>'+
    '<p class="small" style="margin-top:20px">O primeiro usuário a entrar vira <b>admin</b> automaticamente. Admins promovem outros membros.</p>'+
  '</div></div>';
}

function filteredPlayers(){
  let list = cache.players.slice();
  if(filterRole!=='TODOS') list = list.filter(p=>p.role===filterRole);
  if(searchTxt) list = list.filter(p=>p.name.toLowerCase().includes(searchTxt.toLowerCase()));
  list.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  return list;
}

function renderFilterBar(){
  const labels = {TODOS:'Todos', ATACANTE:'Atacante', DEFENSOR:'Defensor', GOLEIRO:'Goleiro'};
  return '<div class="filter-bar"><span class="small">Filtrar:</span>'+
    ['TODOS','ATACANTE','DEFENSOR','GOLEIRO'].map(r =>
      '<button class="chip '+(filterRole===r?'active':'')+'" onclick="filterRole=\''+r+'\';render()">'+labels[r]+'</button>'
    ).join('')+
    '<input class="search" placeholder="🔎 Buscar jogador..." value="'+searchTxt+'" oninput="searchTxt=this.value;render()">'+
  '</div>';
}

function renderAvaliar(){
  const list = filteredPlayers();
  if(list.length===0) return '<div class="card"><div class="empty">Nenhum jogador.</div></div>';
  const lineList = list.filter(p=>p.role!=='GOLEIRO');
  const gkList = list.filter(p=>p.role==='GOLEIRO');
  function tableFor(plist, attrs){
    if(plist.length===0) return '';
    return '<div class="scroll"><table><thead><tr>'+
      '<th>Jogador</th>'+attrs.map(a=>'<th style="text-align:center">'+a+'</th>').join('')+
    '</tr></thead><tbody>'+
    plist.map(p =>
      '<tr><td><b>'+p.name+'</b> <span class="role-tag">'+roleEmoji(p.role)+'</span></td>'+
      attrs.map(a => {
        const v = getMyEval(p.id, a);
        return '<td class="num"><input class="rate-input" data-pid="'+p.id+'" data-attr="'+a+'" type="number" min="'+attrMin(a)+'" max="'+attrMax(a)+'" value="'+(v==null?'':v)+'" oninput="setEval(\''+p.id+'\',\''+a+'\',this.value)" onblur="snapEval(\''+p.id+'\',\''+a+'\',this)" onkeydown="if(event.key===\'Enter\'){this.blur();}"></td>';
      }).join('')+'</tr>'
    ).join('')+'</tbody></table></div>';
  }
  return '<div class="card">'+
    '<h2>📝 Minha Avaliação - Rodada '+currentRound()+'</h2>'+
    '<div class="sub">Dê uma nota pra cada atributo. Seus dados salvam automaticamente no banco.</div>'+
    '<div class="info-banner">🗓️ A rodada é encerrada manualmente pelo admin. Enquanto isso, você pode ajustar suas notas à vontade.</div>'+
    '<p class="small" style="margin:8px 0 14px 0"><i>min. 60 | máx. 99</i> &nbsp;·&nbsp; <i>PNR: 0 a 5</i> &nbsp;·&nbsp; valores fora do limite são ajustados ao perder o foco / apertar Enter</p>'+
    '<div class="row" style="margin-bottom:14px;align-items:center"><button class="btn good" style="flex:0;min-width:140px" onclick="saveAllPending()">💾 Salvar agora</button><span id="saveStatus" class="save-status '+saveStatus+'">'+({idle:'Auto-save ligado',saving:'⏳ Salvando...',saved:'✓ Salvo',error:'✗ Erro ao salvar'}[saveStatus]||'')+'</span></div>'+
    renderFilterBar()+
    (lineList.length>0?'<h2 style="font-size:14px;margin-top:18px">Jogadores de linha</h2>'+tableFor(lineList, LINE_ATTRS):'')+
    (gkList.length>0?'<h2 style="font-size:14px;margin-top:24px">Goleiros</h2>'+tableFor(gkList, GK_ATTRS):'')+
  '</div>';
}

function renderDashboard(){
  const list = filteredPlayers();
  const snap = lastSnapshot();
  const totalEvaluators = cache.profiles.length;
  const playersWithEvals = cache.players.filter(p=>evalCount(p.id)>0).length;
  const lineList = list.filter(p=>p.role!=='GOLEIRO');
  const gkList = list.filter(p=>p.role==='GOLEIRO');

  function rowsFor(plist, attrs){
    if(plist.length===0) return '';
    const computed = plist.map(p=>{
      const cur = {};
      attrs.forEach(a=>{cur[a] = avgEval(p.id, a);});
      const overallAttrs = attrs.filter(a=>a!=='PNR');
      const vals = overallAttrs.map(a=>cur[a]).filter(v=>typeof v==='number');
      const ov = vals.length>0 ? Math.round(vals.reduce((s,v)=>s+v,0)/vals.length) : null;
      return {p, cur, ov};
    });
    computed.sort((a,b)=> (b.ov==null?-1:b.ov) - (a.ov==null?-1:a.ov));
    const top3 = {};
    attrs.forEach(a=>{
      const sorted = computed.slice().filter(x=>typeof x.cur[a]==='number').sort((x,y)=>y.cur[a]-x.cur[a]);
      let pos=1, last=null, lastPos=1;
      const ranks={};
      sorted.forEach(x=>{
        if(last===null || x.cur[a]<last){ ranks[x.p.id]=pos; lastPos=pos; last=x.cur[a]; pos++; }
        else { ranks[x.p.id]=lastPos; pos++; }
      });
      top3[a]={};
      Object.entries(ranks).forEach(pair=>{ if(pair[1]<=3) top3[a][pair[0]]=pair[1]; });
    });
    const topOv = {};
    {
      const sorted = computed.slice().filter(x=>typeof x.ov==='number').sort((x,y)=>y.ov-x.ov);
      let pos=1, last=null, lastPos=1;
      sorted.forEach(x=>{
        if(last===null || x.ov<last){ topOv[x.p.id]=pos; lastPos=pos; last=x.ov; pos++; }
        else { topOv[x.p.id]=lastPos; pos++; }
      });
      Object.keys(topOv).forEach(k=>{ if(topOv[k]>3) delete topOv[k]; });
    }
    function medal(pos){ return pos===1?'🥇':pos===2?'🥈':pos===3?'🥉':''; }
    return '<div class="scroll"><table><thead><tr>'+
      '<th>Jogador</th>'+attrs.map(a=>'<th style="text-align:center">'+a+'</th>').join('')+
      '<th style="text-align:center">OVERALL</th><th style="text-align:center">Aval.</th>'+
    '</tr></thead><tbody>'+
    computed.map(o=>{
      const p=o.p, cur=o.cur, ov=o.ov;
      const prev = (snap && snap.averages && snap.averages[p.id]) ? snap.averages[p.id] : null;
      return '<tr><td><b>'+p.name+'</b> <span class="role-tag">'+roleEmoji(p.role)+'</span></td>'+
        attrs.map(a=>{
          const v=cur[a];
          const m = top3[a][p.id]?'<span class="medal">'+medal(top3[a][p.id])+'</span>':'';
          return '<td class="num">'+m+(v==null?'-':v)+'</td>';
        }).join('')+
        '<td class="num" style="color:var(--acc)">'+
          (topOv[p.id]?'<span class="medal">'+medal(topOv[p.id])+'</span>':'')+
          (ov==null?'-':ov)+
          ((ov!=null && prev && prev.OVERALL!=null) ? arrow(ov, prev.OVERALL) : '')+
        '</td>'+
        '<td class="num small">'+evalCount(p.id)+'/'+totalEvaluators+'</td></tr>';
    }).join('')+'</tbody></table></div>';
  }
  return '<div class="card">'+
    '<h2>📊 Dashboard - Rodada '+currentRound()+'</h2>'+
    '<div class="sub">Médias calculadas em tempo real. As setas comparam contra a última rodada encerrada ('+(snap?snap.round_label:'-')+').</div>'+
    '<div class="grid3" style="margin-bottom:16px">'+
      '<div class="stat"><div class="num">'+totalEvaluators+'</div><div class="lbl">Avaliadores cadastrados</div></div>'+
      '<div class="stat"><div class="num">'+cache.players.length+'</div><div class="lbl">Jogadores</div></div>'+
      '<div class="stat"><div class="num">'+playersWithEvals+'</div><div class="lbl">Jogadores já avaliados</div></div>'+
    '</div>'+
    (isAdmin() ?
      '<div class="row" style="margin-bottom:16px">'+
        '<button class="btn good" onclick="gravarRodada()">🔒 Encerrar Rodada '+currentRound()+'</button>'+
        '<button class="btn warn" onclick="gerarPDF()">📄 PDF da Atualização</button>'+
      '</div>'
      : '<div class="info-banner">Só admins podem encerrar a rodada e gerar o PDF.</div>')+
    renderFilterBar()+
    renderRankingAttrBar()+
    (rankingAttr==='TODOS'
      ? (lineList.length>0?'<h2 style="font-size:14px;margin-top:18px">Jogadores de linha</h2>'+rowsFor(lineList, LINE_ATTRS):'') +
        (gkList.length>0?'<h2 style="font-size:14px;margin-top:24px">Goleiros</h2>'+rowsFor(gkList, GK_ATTRS):'')
      : renderRankByAttr(list, rankingAttr))+
  '</div>';
}

function renderRankingAttrBar(){
  const allAttrs = Array.from(new Set(LINE_ATTRS.concat(GK_ATTRS)));
  return '<div class="filter-bar" style="margin-top:8px"><span class="small">Ranking de:</span>'+
    '<select style="max-width:240px" onchange="rankingAttr=this.value;render()">'+
      '<option value="TODOS"'+(rankingAttr==='TODOS'?' selected':'')+'>Todos atributos (visão completa)</option>'+
      '<option value="OVERALL"'+(rankingAttr==='OVERALL'?' selected':'')+'>OVERALL</option>'+
      allAttrs.map(a => '<option value="'+a+'"'+(rankingAttr===a?' selected':'')+'>'+a+'</option>').join('')+
    '</select>'+
  '</div>';
}

function renderRankByAttr(plist, attr){
  let rows;
  if(attr==='OVERALL'){
    rows = plist.map(p=>({p, v: avgOverall(p)})).filter(x=>typeof x.v==='number');
  } else {
    const isGkOnly = GK_ATTRS.includes(attr) && !LINE_ATTRS.includes(attr);
    const isLineOnly = LINE_ATTRS.includes(attr) && !GK_ATTRS.includes(attr);
    rows = plist
      .filter(p => isGkOnly ? p.role==='GOLEIRO' : isLineOnly ? p.role!=='GOLEIRO' : true)
      .map(p=>({p, v: avgEval(p.id, attr)}))
      .filter(x=>typeof x.v==='number');
  }
  rows.sort((a,b)=>b.v - a.v);
  if(rows.length===0) return '<div class="empty">Nenhum jogador com nota nesse atributo ainda.</div>';
  let pos=1, lastV=null, lastPos=1;
  rows.forEach(r=>{
    if(lastV===null || r.v<lastV){ r.pos=pos; lastPos=pos; lastV=r.v; pos++; }
    else { r.pos=lastPos; pos++; }
  });
  function medal(p){ return p===1?'🥇':p===2?'🥈':p===3?'🥉':''; }
  return '<h2 style="font-size:14px;margin-top:18px">🏆 Ranking - '+attr+' (do maior para o menor)</h2>'+
    '<div class="scroll" style="max-width:600px"><table>'+
      '<thead><tr><th style="width:80px;text-align:center">Pos.</th><th>Jogador</th><th class="num">Nota</th></tr></thead>'+
      '<tbody>'+
      rows.map(r =>
        '<tr><td class="num"><span class="medal">'+medal(r.pos)+'</span>'+r.pos+'º</td>'+
        '<td><b>'+r.p.name+'</b> <span class="role-tag">'+roleEmoji(r.p.role)+'</span></td>'+
        '<td class="num" style="color:var(--acc)">'+r.v+'</td></tr>'
      ).join('')+
      '</tbody></table></div>';
}

function renderRanksIndividuais(){
  if(!isAdmin()) return '<div class="warn-banner">Somente admins.</div>';
  if(cache.profiles.length===0) return '<div class="card"><div class="empty">Sem membros cadastrados ainda.</div></div>';
  const members = cache.profiles.slice().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  if(!viewingUserId || !members.find(m=>m.id===viewingUserId)) viewingUserId = members[0].id;
  const sel = members.find(m=>m.id===viewingUserId);
  const myEvals = cache.evaluations.filter(e => e.user_id === viewingUserId);
  const playersWithEvals = new Set(myEvals.map(e=>e.player_id));
  const totalAvaliados = playersWithEvals.size;
  const list = filteredPlayers();
  const lineList = list.filter(p=>p.role!=='GOLEIRO');
  const gkList = list.filter(p=>p.role==='GOLEIRO');
  function tableFor(plist, attrs){
    if(plist.length===0) return '';
    return '<div class="scroll"><table><thead><tr>'+
      '<th>Jogador</th>'+attrs.map(a=>'<th style="text-align:center">'+a+'</th>').join('')+
    '</tr></thead><tbody>'+
    plist.map(p=>{
      return '<tr><td><b>'+p.name+'</b> <span class="role-tag">'+roleEmoji(p.role)+'</span></td>'+
        attrs.map(a=>{
          const ev = myEvals.find(e => e.player_id===p.id && e.attr===a);
          const v = ev ? ev.value : null;
          return '<td class="num" style="'+(v==null?'color:var(--muted);opacity:.4':'')+'">'+(v==null?'-':v)+'</td>';
        }).join('')+'</tr>';
    }).join('')+'</tbody></table></div>';
  }
  return '<div class="card">'+
    '<h2>👁️ Ranks Individuais</h2>'+
    '<div class="sub">Veja exatamente as notas que cada membro deu. Somente leitura - quem edita as notas é o próprio membro na aba dele.</div>'+
    '<div class="row" style="margin-bottom:14px">'+
      '<div style="flex:2"><label>Ver avaliações de:</label>'+
        '<select onchange="viewingUserId=this.value;render()">'+
        members.map(m =>
          '<option value="'+m.id+'"'+(m.id===viewingUserId?' selected':'')+'>'+
            m.name + (m.is_admin?' (admin)':'') +
          '</option>'
        ).join('')+
        '</select>'+
      '</div>'+
      '<div style="flex:0;min-width:200px"><label>&nbsp;</label><div class="stat" style="padding:8px"><div class="num" style="font-size:16px">'+totalAvaliados+'/'+cache.players.length+'</div><div class="lbl">Jogadores avaliados</div></div></div>'+
    '</div>'+
    renderFilterBar()+
    (lineList.length>0?'<h2 style="font-size:14px;margin-top:18px">Jogadores de linha - avaliação de '+sel.name+'</h2>'+tableFor(lineList, LINE_ATTRS):'')+
    (gkList.length>0?'<h2 style="font-size:14px;margin-top:24px">Goleiros - avaliação de '+sel.name+'</h2>'+tableFor(gkList, GK_ATTRS):'')+
  '</div>';
}

function renderJogadores(){
  if(!isAdmin()) return '<div class="warn-banner">Somente admins.</div>';
  const list = cache.players.slice().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  return '<div class="card">'+
    '<h2>👥 Jogadores</h2>'+
    '<div class="sub">Adicione, remova ou ajuste a role. Removê-los apaga as avaliações também.</div>'+
    '<div class="row">'+
      '<div style="flex:2"><label>Nome do novo jogador</label><input id="newPName" placeholder="Ex.: Ceceu"></div>'+
      '<div><label>Role</label><select id="newPRole">'+
        '<option value="ATACANTE">⚔️ Atacante</option>'+
        '<option value="DEFENSOR">🛡️ Defensor</option>'+
        '<option value="GOLEIRO">🥅 Goleiro</option>'+
      '</select></div>'+
      '<div style="flex:0"><button class="btn" onclick="addPlayer()">+ Adicionar</button></div>'+
    '</div>'+
  '</div>'+
  '<div class="card"><h2>Lista ('+list.length+')</h2>'+
    '<table><thead><tr><th>Nome</th><th>Role</th><th style="text-align:center">Avaliações</th><th></th></tr></thead><tbody>'+
    list.map(p=>
      '<tr><td><b>'+p.name+'</b> '+roleEmoji(p.role)+'</td>'+
      '<td><select onchange="changeRole(\''+p.id+'\', this.value)" style="max-width:160px">'+
        '<option value="ATACANTE"'+(p.role==='ATACANTE'?' selected':'')+'>⚔️ Atacante</option>'+
        '<option value="DEFENSOR"'+(p.role==='DEFENSOR'?' selected':'')+'>🛡️ Defensor</option>'+
        '<option value="GOLEIRO"'+(p.role==='GOLEIRO'?' selected':'')+'>🥅 Goleiro</option>'+
      '</select></td>'+
      '<td class="num">'+evalCount(p.id)+'/'+cache.profiles.length+'</td>'+
      '<td style="text-align:right"><button class="btn danger" onclick="removePlayer(\''+p.id+'\')">Remover</button></td></tr>'
    ).join('')+
    '</tbody></table></div>';
}

function renderMembros(){
  if(!isAdmin()) return '<div class="warn-banner">Somente admins.</div>';
  const list = cache.profiles.slice().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  return '<div class="card">'+
    '<h2>⚙️ Membros</h2>'+
    '<div class="sub">Promova membros para admin. Use <b>Remover</b> pra cadastros duplicados - os votos do membro removido saem da média automaticamente.</div>'+
    '<table><thead><tr><th>Nome</th><th>Papel</th><th style="text-align:center">Jogadores avaliados</th><th></th></tr></thead><tbody>'+
    list.map(u=>{
      const count = new Set(cache.evaluations.filter(e=>e.user_id===u.id).map(e=>e.player_id)).size;
      const nameEsc = u.name.replace(/'/g,"\\'");
      return '<tr>'+
        '<td><b>'+u.name+'</b> '+(u.id===me.id?'<span class="pill">(você)</span>':'')+'</td>'+
        '<td>'+(u.is_admin?'<span class="pill adm">ADMIN</span>':'<span class="pill">Membro</span>')+'</td>'+
        '<td class="num">'+count+'/'+cache.players.length+'</td>'+
        '<td style="text-align:right">'+
          (u.is_admin && u.id!==me.id ? '<button class="btn sec" onclick="demote(\''+u.id+'\',\''+nameEsc+'\')">Rebaixar</button> ' : '')+
          (!u.is_admin ? '<button class="btn good" onclick="promote(\''+u.id+'\',\''+nameEsc+'\')">Promover a Admin</button> ' : '')+
          (u.id!==me.id ? '<button class="btn danger" onclick="removeUser(\''+u.id+'\',\''+nameEsc+'\')">🗑️ Remover</button>' : '')+
        '</td></tr>';
    }).join('')+
    '</tbody></table></div>';
}

function renderHistorico(){
  if(!isAdmin()) return '<div class="warn-banner">Somente admins.</div>';
  if(cache.rounds.length===0) return '<div class="card"><div class="empty">Sem rodadas encerradas ainda.</div></div>';
  return '<div class="card"><h2>🕓 Histórico de Rodadas</h2>'+
    '<div class="sub">Cada vez que você encerra uma rodada, vira um snapshot. As setas do Dashboard comparam contra a última.</div>'+
    cache.rounds.slice().reverse().map((h,i)=>
      '<details '+(i===0?'open':'')+'>'+
        '<summary>📦 Rodada '+h.round_label+' - '+new Date(h.closed_at).toLocaleString('pt-BR')+'</summary>'+
        '<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Jogador</th><th class="num" style="text-align:center">OVERALL</th></tr></thead><tbody>'+
        Object.entries(h.averages||{}).map(pair=>{
          const pid=pair[0], vals=pair[1];
          const p = cache.players.find(x=>x.id===pid);
          return '<tr><td>'+(p?p.name+' '+roleEmoji(p.role):'(removido)')+'</td><td class="num">'+(vals.OVERALL==null?'-':vals.OVERALL)+'</td></tr>';
        }).join('')+
        '</tbody></table></div></details>'
    ).join('')+
  '</div>';
}

function toast(msg, kind){
  kind = kind || '';
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function(){ el.style.opacity='0'; setTimeout(function(){el.remove();}, 300); }, 2800);
}

init();
