// Merged 1H candles -> 4H candles per coin (cache + recent OKX), deduped by time.
const fs=require('fs'),path=require('path');
const S=path.join(__dirname,'..');
function load(coin){
  const base = coin==='BTC' ? require('/home/user/BTCTradeBot/backtest/cache/BTCUSDT-1H.json') : JSON.parse(fs.readFileSync(path.join(S,coin+'-1H.json')));
  const arr=(Array.isArray(base)?base:base.candles).concat(JSON.parse(fs.readFileSync(path.join(__dirname,coin+'-recent.json'))));
  const m=new Map(); for(const k of arr) m.set(k.t,k);
  const h=[...m.values()].sort((a,b)=>a.t-b.t);
  const H4=4*3600e3, out=[]; let cur=null;
  for(const k of h){ const t=Math.floor(k.t/H4)*H4;
    if(!cur||cur.t!==t){ if(cur&&cur.n===4) out.push(cur); cur={t,o:k.o,h:k.h,l:k.l,c:k.c,v:k.v,n:1}; }
    else { cur.h=Math.max(cur.h,k.h); cur.l=Math.min(cur.l,k.l); cur.c=k.c; cur.v+=k.v; cur.n++; } }
  if(cur&&cur.n===4) out.push(cur);
  return out;
}
module.exports={load};
