const {load,ind,sim,STRATS,portfolio}=require('./bt');
const coins=['BTC','ETH','HYPE'];const D={};for(const c of coins){const k=load(c);D[c]={k,I:ind(k)}}
const P=(s)=>Date.parse(s);
const windows=[['2y',P('2024-10-17'),P('2026-10-18')],['y1',P('2024-10-17'),P('2025-10-17')],['y2',P('2025-10-17'),P('2026-10-18')],['last3w',P('2026-09-26'),P('2026-10-18')]];
const variants=JSON.parse(process.argv[2]||'[]');
for(const [name,strat,p] of variants){
 const row=[];
 for(const [wn,from,to] of windows){const all=[];const per={};for(const c of coins){const {k,I}=D[c];const tr=sim(k,I,STRATS[strat](k,I,p),from,to);per[c]=tr;all.push(...tr)}
  const r=portfolio(all,2,40);const months=(Math.min(to,Date.now())-from)/(30.4*864e5);
  row.push(`${wn}: n${r.n} (${(r.n/months).toFixed(1)}/mo) win ${(r.win*100).toFixed(0)}% PF ${r.pf.toFixed(2)} avg ${r.avgR.toFixed(2)}R $${r.pnl.toFixed(0)} DD $${r.dd.toFixed(0)}`)}
 console.log(name.padEnd(28),'\n   '+row.join('\n   '));
}
