// Backtest of the candidate strategies on 4H candles. Trades are in R (risk units):
// a stop-out = -1R before costs. Costs: 0.05% taker per side + 0.05% slippage per side = 0.2% of price round trip.
const {load}=require('./data');
const COST=0.002;
function ema(a,n){const k=2/(n+1),o=[];let e=null;for(let i=0;i<a.length;i++){e=e==null?a[i]:a[i]*k+e*(1-k);o.push(e)}return o}
function sma(a,n){const o=[];let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=n)s-=a[i-n];o.push(i>=n-1?s/n:null)}return o}
function std(a,n,m){const o=[];for(let i=0;i<a.length;i++){if(i<n-1){o.push(null);continue}let s=0;for(let j=i-n+1;j<=i;j++)s+=(a[j]-m[i])**2;o.push(Math.sqrt(s/n))}return o}
function rsi(c,n=14){const o=[null];let g=0,l=0;for(let i=1;i<c.length;i++){const d=c[i]-c[i-1];const up=Math.max(d,0),dn=Math.max(-d,0);if(i<=n){g+=up/n;l+=dn/n;o.push(i===n?100-100/(1+g/(l||1e-9)):null)}else{g=(g*(n-1)+up)/n;l=(l*(n-1)+dn)/n;o.push(100-100/(1+g/(l||1e-9)))}}return o}
function atr(k,n=14){const o=[];let a=null;for(let i=0;i<k.length;i++){const tr=i?Math.max(k[i].h-k[i].l,Math.abs(k[i].h-k[i-1].c),Math.abs(k[i].l-k[i-1].c)):k[i].h-k[i].l;a=a==null?tr:(a*(n-1)+tr)/n;o.push(a)}return o}
function adx(k,n=14){const o=[];let tr=0,pdm=0,ndm=0,ad=null;const dxs=[];for(let i=0;i<k.length;i++){if(!i){o.push(null);continue}
 const up=k[i].h-k[i-1].h,dn=k[i-1].l-k[i].l;const p=up>dn&&up>0?up:0,m=dn>up&&dn>0?dn:0;const t=Math.max(k[i].h-k[i].l,Math.abs(k[i].h-k[i-1].c),Math.abs(k[i].l-k[i-1].c));
 tr=tr-tr/n+t;pdm=pdm-pdm/n+p;ndm=ndm-ndm/n+m;const pdi=100*pdm/tr,ndi=100*ndm/tr;const dx=100*Math.abs(pdi-ndi)/((pdi+ndi)||1);
 ad=ad==null?dx:(ad*(n-1)+dx)/n;o.push(i>2*n?ad:null)}return o}
function ind(k){const c=k.map(x=>x.c);const m20=sma(c,20);return{c,m20,sd:std(c,20,m20),rsi:rsi(c),atr:atr(k),adx:adx(k),e20:ema(c,20),e50:ema(c,50),e200:ema(c,200)}}

// Generic simulator: sig(i) -> {bias, stop, tp, trail(ATR mult)|null, maxBars} decided on close of candle i, filled at open of i+1.
function sim(k,I,sig,from,to){const tr=[];let pos=null;
 for(let i=200;i<k.length;i++){const K=k[i];
  if(pos){ // manage on candle i (entered at open of pos.i0)
   let exit=null,why=null;
   const hitS=pos.bias>0?K.l<=pos.stop:K.h>=pos.stop, hitT=pos.tp!=null&&(pos.bias>0?K.h>=pos.tp:K.l<=pos.tp);
   if(hitS){exit=pos.bias>0?Math.min(pos.stop,K.o):Math.max(pos.stop,K.o);why='stop'} // gap through stop fills at open
   else if(hitT){exit=pos.tp;why='tp'}
   else if(pos.maxBars&&i-pos.i0>=pos.maxBars-1){exit=K.c;why='time'}
   else if(pos.exitFn&&pos.exitFn(i,pos)){exit=K.c;why='signal'}
   if(exit!=null){const r=((exit-pos.entry)*pos.bias-COST*pos.entry)/pos.risk;tr.push({t0:k[pos.i0].t,t1:K.t,bias:pos.bias,r,why});pos=null}
   else if(pos.trail){pos.ext=pos.bias>0?Math.max(pos.ext,K.c):Math.min(pos.ext,K.c);const s=pos.ext-pos.bias*pos.trail*I.atr[i];if(pos.bias>0?s>pos.stop:s<pos.stop)pos.stop=s}
  }
  if(!pos&&K.t>=from&&K.t<to&&i+1<k.length){const s=sig(i);if(s){const entry=k[i+1].o;const stop=s.stopAbs!=null?s.stopAbs:entry-s.bias*s.stopDist;const risk=Math.abs(entry-stop);
   if(risk>0&&(s.tp==null||(s.tp-entry)*s.bias>0))pos={i0:i+1,ext:I.c[i],bias:s.bias,entry,stop,risk,tp:s.tp,trail:s.trail||null,maxBars:s.maxBars||0,exitFn:s.exitFn}}}
 }return tr}

const STRATS={
 // A: range / mean reversion at the Bollinger bands, only when ADX says "no trend"
 A:(k,I,p={})=>{const bw=p.bw||2,adxMax=p.adxMax??25,rl=p.rl||30,rh=100-(p.rl||30),sl=p.sl||1.5;
  return i=>{const lo=I.m20[i]-bw*I.sd[i],hi=I.m20[i]+bw*I.sd[i];if(I.m20[i]==null||I.adx[i]==null)return null;if(adxMax&&I.adx[i]>adxMax)return null;
   if(I.c[i]<lo&&I.rsi[i]<rl)return{bias:1,stopDist:sl*I.atr[i],tp:I.m20[i],maxBars:p.mb||12};
   if(I.c[i]>hi&&I.rsi[i]>rh)return{bias:-1,stopDist:sl*I.atr[i],tp:I.m20[i],maxBars:p.mb||12};return null}},
 // B: trend pullback: trend = EMA50 vs EMA200 and close vs EMA200; entry when price dipped to EMA20 and closes back on the trend side
 B:(k,I,p={})=>{const sl=p.sl||2,tr=p.trail||3,adxMin=p.adxMin||0;
  return i=>{if(i<1)return null;if(adxMin&&!(I.adx[i]>adxMin))return null;
   const up=I.e50[i]>I.e200[i]&&I.c[i]>I.e200[i],dn=I.e50[i]<I.e200[i]&&I.c[i]<I.e200[i];
   if(up&&k[i].l<=I.e20[i]&&I.c[i]>I.e20[i]&&I.c[i-1]>I.e50[i-1])return{bias:1,stopDist:sl*I.atr[i],tp:p.rr?null:null,trail:tr};
   if(dn&&k[i].h>=I.e20[i]&&I.c[i]<I.e20[i]&&I.c[i-1]<I.e50[i-1])return{bias:-1,stopDist:sl*I.atr[i],trail:tr};return null}},
};
STRATS.C=(k,I,p={})=>{const a=STRATS.A(k,I,{...p,adxMax:p.lo||20}),b=STRATS.B(k,I,{...p,adxMin:p.hi||25});return i=>b(i)||a(i)};

// Portfolio: merge trades of all coins, at most `maxPos` open at once, fixed $risk per trade.
function portfolio(all,maxPos,risk){const ev=all.slice().sort((a,b)=>a.t0-b.t0);const open=[];let eq=0,peak=0,dd=0;const taken=[];
 for(const t of ev){for(let j=open.length-1;j>=0;j--)if(open[j].t1<=t.t0)open.splice(j,1);if(open.length>=maxPos)continue;open.push(t);taken.push(t)}
 taken.sort((a,b)=>a.t1-b.t1);for(const t of taken){eq+=t.r*risk;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq)}
 const w=taken.filter(t=>t.r>0),l=taken.filter(t=>t.r<=0);const gw=w.reduce((s,t)=>s+t.r,0),gl=-l.reduce((s,t)=>s+t.r,0);
 return{n:taken.length,win:taken.length?w.length/taken.length:0,pf:gl?gw/gl:Infinity,avgR:taken.length?(gw-gl)/taken.length:0,pnl:eq,dd,taken}}
module.exports={load,ind,sim,STRATS,portfolio};
