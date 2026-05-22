/* ============================================================
   FUT RAIZ - Geração do PDF da Atualização
   Depende de variáveis globais de app.js: cache, LINE_ATTRS, GK_ATTRS,
   avgEval, avgOverall, currentRound, lastSnapshot, isAdmin, toast
   ============================================================ */

function gerarPDF(){
  if(!isAdmin()) return;
  const jsPDF = window.jspdf.jsPDF;
  const doc = new jsPDF({orientation:'landscape', unit:'pt', format:'a4'});
  const snap = lastSnapshot();

  doc.setFontSize(16);
  doc.text('RANK GERAL - FUT RAIZ', 40, 40);
  doc.setFontSize(10);
  doc.text('Rodada: '+currentRound()+'   |   Comparacao vs: '+(snap?snap.round_label:'-')+'   |   Gerado em '+new Date().toLocaleString('pt-BR'), 40, 56);

  const lineList = cache.players.filter(p=>p.role!=='GOLEIRO').sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  const lineRows = lineList.map(p=>{
    const row = [p.name + ' ' + (p.role==='ATACANTE'?'(ATA)':'(DEF)')];
    LINE_ATTRS.forEach(a=>{ const v = avgEval(p.id,a); row.push(v==null?'-':v); });
    const ov = avgOverall(p);
    let cell = ov==null?'-':String(ov);
    if(ov!=null && snap && snap.averages[p.id] && snap.averages[p.id].OVERALL!=null){
      const d = ov - snap.averages[p.id].OVERALL;
      if(d>0) cell += ' (+'+d+')'; else if(d<0) cell += ' ('+d+')';
    }
    row.push(cell);
    return row;
  });
  doc.autoTable({startY:70, head:[['Nome'].concat(LINE_ATTRS).concat(['OVERALL'])], body:lineRows,
    styles:{fontSize:8,cellPadding:3}, headStyles:{fillColor:[31,39,51],textColor:[255,255,255]},
    alternateRowStyles:{fillColor:[245,245,250]}});

  const gks = cache.players.filter(p=>p.role==='GOLEIRO').sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  if(gks.length){
    doc.addPage(); doc.setFontSize(14); doc.text('Goleiros', 40, 40);
    const gkRows = gks.map(p=>{
      const row = [p.name + ' (GK)'];
      GK_ATTRS.forEach(a=>{ const v = avgEval(p.id,a); row.push(v==null?'-':v); });
      const ov = avgOverall(p);
      let cell = ov==null?'-':String(ov);
      if(ov!=null && snap && snap.averages[p.id] && snap.averages[p.id].OVERALL!=null){
        const d = ov - snap.averages[p.id].OVERALL;
        if(d>0) cell += ' (+'+d+')'; else if(d<0) cell += ' ('+d+')';
      }
      row.push(cell);
      return row;
    });
    doc.autoTable({startY:60, head:[['Nome'].concat(GK_ATTRS).concat(['OVERALL'])], body:gkRows,
      styles:{fontSize:8,cellPadding:3}, headStyles:{fillColor:[31,39,51],textColor:[255,255,255]}});
  }

  // Rank Geral por OVERALL
  doc.addPage();
  doc.setFontSize(14);
  doc.text('Rank Geral - OVERALL', 40, 40);
  const allOv = cache.players.map(p => ({p, ov: avgOverall(p)})).filter(x => x.ov != null).sort((a,b) => b.ov - a.ov);
  let ovPos = 1, ovLast = null, ovLastPos = 1;
  const ovRows = allOv.map(x => {
    let pos;
    if(ovLast === null || x.ov < ovLast){ pos = ovPos; ovLastPos = ovPos; ovLast = x.ov; }
    else pos = ovLastPos;
    ovPos++;
    const tag = x.p.role==='ATACANTE'?'(ATA)':x.p.role==='DEFENSOR'?'(DEF)':'(GK)';
    let delta = '';
    if(snap && snap.averages[x.p.id] && snap.averages[x.p.id].OVERALL!=null){
      const d = x.ov - snap.averages[x.p.id].OVERALL;
      if(d>0) delta = ' (+'+d+')'; else if(d<0) delta = ' ('+d+')';
    }
    return [pos+'o', x.p.name+' '+tag, x.ov + delta];
  });
  doc.autoTable({startY: 60, head: [['Pos.', 'Jogador', 'OVERALL']], body: ovRows,
    styles:{fontSize:9, cellPadding:4}, headStyles:{fillColor:[31,39,51], textColor:[255,255,255]},
    alternateRowStyles:{fillColor:[245,245,250]},
    columnStyles: {0:{cellWidth:60, halign:'center'}, 2:{cellWidth:90, halign:'center'}}});

  // Ranks individuais por atributo
  doc.addPage(); doc.setFontSize(14); doc.text('Ranks individuais - Jogadores de linha', 40, 40);
  let yPos = 60;
  LINE_ATTRS.forEach((a,idx)=>{
    const ranked = lineList.map(p=>({n:p.name, v: avgEval(p.id, a)})).filter(x=>x.v!=null).sort((x,y)=>y.v-x.v);
    if(ranked.length===0) return;
    const col = idx % 3;
    if(col===0 && idx>0){ doc.addPage(); yPos=40; doc.setFontSize(14); doc.text('Ranks individuais (cont.)', 40, yPos); yPos=60; }
    doc.autoTable({startY:yPos, margin:{left:40+col*270}, tableWidth:250,
      head:[[a,'Nota','Pos.']], body:ranked.slice(0,30).map((x,i)=>[x.n, x.v, (i+1)+'o']),
      styles:{fontSize:7,cellPadding:2}, headStyles:{fillColor:[31,39,51],textColor:[255,255,255]}});
    if(col===2){ yPos = doc.lastAutoTable.finalY + 14; }
  });

  doc.save('futraiz_'+currentRound()+'.pdf');
  toast('PDF gerado!', 'good');
}
