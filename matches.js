/* ============================================================
   FUT RAIZ - Score dos Futs (Partidas)
   Funções de criação, edição e encerramento de partidas.
   Depende de variáveis globais definidas em app.js:
   supa, me, cache, render(), isAdmin(), roleEmoji, setSaveStatus, pendingSaves, saveStatus
   ============================================================ */

function matchLabel(){
  const d = new Date();
  const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = d.getFullYear();
  return 'Partida - '+dd+'/'+mm+'/'+yy+' - '+dias[d.getDay()];
}

async function createMatch(){
  if(!isAdmin()) return;
  const { error } = await supa.from('matches').insert({label: matchLabel(), created_by: me.id});
  if(error) return toast('Erro: '+error.message, 'bad');
  await loadAll(); render(); toast('Partida criada!', 'good');
}

async function addPlayerToMatch(matchId, playerId){
  const { error } = await supa.from('match_stats').upsert({match_id: matchId, player_id: playerId, goals:0, assists:0, defenses:0, updated_by: me.id});
  if(error) return toast('Erro: '+error.message, 'bad');
  const exists = cache.matchStats.findIndex(s => s.match_id===matchId && s.player_id===playerId);
  if(exists<0) cache.matchStats.push({match_id:matchId, player_id:playerId, goals:0, assists:0, defenses:0});
  matchSearchTxt = '';
  render();
}

async function removePlayerFromMatch(matchId, playerId){
  if(!confirm('Remover esse jogador da partida?')) return;
  const { error } = await supa.from('match_stats').delete().match({match_id: matchId, player_id: playerId});
  if(error) return toast('Erro: '+error.message, 'bad');
  cache.matchStats = cache.matchStats.filter(s => !(s.match_id===matchId && s.player_id===playerId));
  render();
}

const matchStatTimers = {};
function setMatchStat(matchId, playerId, field, raw){
  const v = Math.max(0, parseInt(raw,10) || 0);
  const s = cache.matchStats.find(x => x.match_id===matchId && x.player_id===playerId);
  if(s) s[field] = v;
  const key = matchId+'_'+playerId+'_'+field;
  clearTimeout(matchStatTimers[key]);
  matchStatTimers[key] = setTimeout(async () => {
    pendingSaves++; setSaveStatus('saving');
    const upd = {match_id: matchId, player_id: playerId, goals: s ? (s.goals||0) : 0, assists: s ? (s.assists||0) : 0, defenses: s ? (s.defenses||0) : 0, updated_by: me.id};
    const { error } = await supa.from('match_stats').upsert(upd);
    pendingSaves--;
    if(error){ setSaveStatus('error'); toast('Erro: '+error.message, 'bad'); }
    else if(pendingSaves===0) setSaveStatus('saved');
  }, 600);
}

async function saveMatchPending(){
  Object.keys(matchStatTimers).forEach(k => clearTimeout(matchStatTimers[k]));
  setSaveStatus('saving');
  for(const s of cache.matchStats){
    await supa.from('match_stats').upsert({match_id:s.match_id, player_id:s.player_id, goals:s.goals||0, assists:s.assists||0, defenses:s.defenses||0, updated_by: me.id});
  }
  setSaveStatus('saved');
  toast('Partida salva!', 'good');
}

async function closeMatch(matchId){
  if(!isAdmin()) return;
  if(!confirm('Encerrar essa partida? Depois disso ela vira somente leitura.')) return;
  const { error } = await supa.from('matches').update({closed_at: new Date().toISOString(), closed_by: me.id}).eq('id', matchId);
  if(error) return toast('Erro: '+error.message, 'bad');
  await loadAll(); render(); toast('Partida encerrada.', 'good');
}

async function deleteMatch(matchId){
  if(!isAdmin()) return;
  if(!confirm('EXCLUIR essa partida e todas as estatisticas dela? Acao irreversivel.')) return;
  const { error } = await supa.from('matches').delete().eq('id', matchId);
  if(error) return toast('Erro: '+error.message, 'bad');
  await loadAll(); render();
}

function renderScore(){
  const open = cache.matches.filter(m => !m.closed_at);
  const closed = cache.matches.filter(m => m.closed_at);

  function renderMatch(m, readOnly){
    const stats = cache.matchStats.filter(s => s.match_id === m.id);
    const playerById = id => cache.players.find(p => p.id===id);
    const playersInMatchIds = new Set(stats.map(s => s.player_id));
    const availablePlayers = cache.players
      .filter(p => !playersInMatchIds.has(p.id))
      .filter(p => !matchSearchTxt || p.name.toLowerCase().includes(matchSearchTxt.toLowerCase()))
      .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));

    const totals = stats.reduce((t,s)=>({g:t.g+(s.goals||0), a:t.a+(s.assists||0), d:t.d+(s.defenses||0)}), {g:0,a:0,d:0});

    return '<div class="card">'+
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap">'+
        '<h2 style="margin:0">⚽ '+m.label+'</h2>'+
        (readOnly ? '<span class="pill" style="background:rgba(98,212,137,.12);color:var(--acc2)">ENCERRADA</span>' : '<span class="pill" style="background:rgba(255,179,71,.12);color:var(--warn)">ABERTA</span>')+
      '</div>'+
      '<div class="sub">'+(readOnly ? 'Encerrada em '+new Date(m.closed_at).toLocaleString('pt-BR') : 'Criada em '+new Date(m.created_at).toLocaleString('pt-BR')+' · Todos os membros podem editar')+'</div>'+

      (!readOnly ? '<div class="row" style="margin-bottom:10px;align-items:center">'+
        '<div style="flex:2"><label>Adicionar jogador na partida</label>'+
          '<input class="search" placeholder="🔎 Buscar jogador pelo nome..." value="'+matchSearchTxt.replace(/"/g,'&quot;')+'" oninput="matchSearchTxt=this.value;render()">'+
        '</div>'+
        (isAdmin() ? '<div style="flex:0"><button class="btn good" onclick="closeMatch(\''+m.id+'\')">🔒 Encerrar Partida</button></div>' : '')+
        (isAdmin() ? '<div style="flex:0"><button class="btn danger" onclick="deleteMatch(\''+m.id+'\')">🗑️ Excluir</button></div>' : '')+
      '</div>'+
      (matchSearchTxt ? '<div class="scroll" style="max-height:200px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;margin-bottom:10px">'+
        (availablePlayers.length===0 ? '<div class="empty" style="padding:14px">Nenhum jogador encontrado</div>' :
          availablePlayers.slice(0,10).map(p =>
            '<div onclick="addPlayerToMatch(\''+m.id+'\',\''+p.id+'\')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--line)" onmouseover="this.style.background=\'rgba(62,166,255,.08)\'" onmouseout="this.style.background=\'\'">'+
              '<b>'+p.name+'</b> <span class="role-tag">'+roleEmoji(p.role)+'</span>'+
            '</div>'
          ).join(''))+
      '</div>' : '')
      : '')+

      (stats.length===0 ? '<div class="empty">Nenhum jogador adicionado ainda.</div>' :
        '<div class="scroll"><table>'+
          '<thead><tr><th>Jogador</th><th style="text-align:center">⚽ Gols</th><th style="text-align:center">🅰️ Assist.</th><th style="text-align:center">🧤 Defesas</th>'+(readOnly?'':'<th></th>')+'</tr></thead>'+
          '<tbody>'+
          stats.slice().sort((a,b)=>{
            const pa = playerById(a.player_id), pb = playerById(b.player_id);
            return (pa?pa.name:'').localeCompare(pb?pb.name:'','pt-BR');
          }).map(s => {
            const p = playerById(s.player_id);
            if(!p) return '';
            return '<tr><td><b>'+p.name+'</b> <span class="role-tag">'+roleEmoji(p.role)+'</span></td>'+
              ['goals','assists','defenses'].map(f =>
                '<td class="num">'+(readOnly ?
                  (s[f]||0) :
                  '<input class="rate-input" type="number" min="0" max="999" value="'+(s[f]||0)+'" oninput="setMatchStat(\''+m.id+'\',\''+s.player_id+'\',\''+f+'\',this.value)">')+
                '</td>'
              ).join('')+
              (readOnly?'':'<td style="text-align:right"><button class="btn danger" style="padding:4px 10px" onclick="removePlayerFromMatch(\''+m.id+'\',\''+s.player_id+'\')">×</button></td>')+
            '</tr>';
          }).join('')+
          '<tr style="background:var(--bg3);font-weight:700"><td>TOTAL ('+stats.length+' jogadores)</td><td class="num" style="color:var(--acc)">'+totals.g+'</td><td class="num" style="color:var(--acc)">'+totals.a+'</td><td class="num" style="color:var(--acc)">'+totals.d+'</td>'+(readOnly?'':'<td></td>')+'</tr>'+
          '</tbody></table></div>'
      )+

      (!readOnly && stats.length>0 ? '<div class="row" style="margin-top:14px;align-items:center"><button class="btn good" style="flex:0;min-width:140px" onclick="saveMatchPending()">💾 Salvar agora</button><span id="saveStatus" class="save-status '+saveStatus+'">'+({idle:'Auto-save ligado',saving:'⏳ Salvando...',saved:'✓ Salvo',error:'✗ Erro'}[saveStatus]||'')+'</span></div>' : '')+
    '</div>';
  }

  return '<div class="card">'+
    '<h2>⚽ Score dos Futs</h2>'+
    '<div class="sub">Anote gols, assistências e defesas durante a partida. Todos os membros podem editar a partida aberta.</div>'+
    (isAdmin() ? '<div class="row" style="margin-bottom:0"><button class="btn" onclick="createMatch()">+ Criar Partida</button></div>' : '<div class="info-banner">Só admins podem criar partidas. Você pode editar a partida aberta abaixo.</div>')+
  '</div>'+

  (open.length===0 && closed.length===0 ? '<div class="card"><div class="empty">Nenhuma partida ainda. '+(isAdmin()?'Clique em "+ Criar Partida" pra começar.':'Aguarde o admin criar uma.')+'</div></div>' : '')+

  open.map(m => renderMatch(m, false)).join('')+

  (closed.length>0 ? '<div class="card"><h2>🕓 Partidas Encerradas</h2>' +
    closed.map(m => '<details style="margin-bottom:8px"><summary><b>'+m.label+'</b> · '+new Date(m.closed_at).toLocaleDateString('pt-BR')+'</summary><div style="margin-top:10px">'+renderMatch(m, true)+'</div></details>').join('')
  + '</div>' : '');
}
