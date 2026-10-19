const {load,ind,sim,STRATS,portfolio}=require('./bt');
const P=Date.parse;const coins=['BTC','ETH','HYPE'];const D={};for(const c of coins){const k=load(c);D[c]={k,I:ind(k)}}
const p=JSON.parse(process.argv[2]);
const wins=[['2021',P('2021-01-01'),P('2022-01-01')],['2022',P('2022-01-01'),P('2023-01-01')],['2023',P('2023-01-01'),P('2024-01-01')],['2024',P('2024-01-01'),P('2025-01-01')],['2025',P('2025-01-01'),P('2026-01-01')],['2026ytd',P('2026-01-01'),P('2026-10-18')]];
for(const [wn,f,t] of wins){let s=wn.padEnd(8);const all=[];for(const c of coins){const tr=sim(D[c].k,D[c].I,STRATS.B(D[c].k,D[c].I,p),f,t);all.push(...tr);const r=portfolio(tr,1,40);s+=` ${c}: n${r.n} PF ${r.pf.toFixed(2)} $${r.pnl.toFixed(0)} |`}
 const r=portfolio(all,2,40);console.log(s,` ALL(max2): n${r.n} win ${(r.win*100).toFixed(0)}% PF ${r.pf.toFixed(2)} $${r.pnl.toFixed(0)} DD $${r.dd.toFixed(0)}`)}
