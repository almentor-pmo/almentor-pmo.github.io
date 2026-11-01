/* almentor Costing & Quotes. Prices: costing/data.enc (synced hourly from the price list Excel). Quotes: costing/quotes/*.enc */
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const r0=v=>Math.round(v||0);
const fN=v=>r0(v).toLocaleString("en-US");
const fUSD=v=>"$"+fN(v);
const fUSD2=v=>"$"+(Math.round((v||0)*100)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const pct=v=>v==null||!isFinite(v)?"—":(Math.round(v*1000)/10)+"%";
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const fD=s=>{if(!s)return"—";const [y,m,d]=s.slice(0,10).split("-");return `${+d} ${MON[+m-1]} ${y}`};
const addDays=(s,n)=>{const d=new Date(s+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const relTime=d=>{const m=Math.round((Date.now()-d)/60000);if(m<1)return"just now";if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<48)return h+" h ago";return Math.round(h/24)+" days ago"};
const initials=s=>String(s).split(/[\s-]+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"?";
const uidGen=()=>Math.random().toString(36).slice(2,9);
const ROLES=["Content","Design","Media","QA"];
const STATUSES=["Draft","Sent","Won","Lost"];
function toast(m){const t=$("#toast");t.textContent=m;t.style.display="block";clearTimeout(toast.t);toast.t=setTimeout(()=>t.style.display="none",4200)}

/* ---------- state ---------- */
const S={d:null,status:null,token:"",user:"",role:"sales",view:"quotes",quotes:[],qLoaded:false,q:null,sha:null,dirty:false,qs:"",qst:"",busy:false};
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
let PREP=ls.get("cost.prep")||"";

/* ---------- pricing engine ---------- */
// a "pricing" object: {rates, settings, fx:{CUR:{rate}}, options:[...]}. Drafts use the live price list; sent/won/lost quotes keep the snapshot saved with them.
const live=()=>({rates:S.d.rates,settings:S.d.settings,fx:S.d.fx,options:S.d.options});
const pz=q=>q.status!=="Draft"&&q.pz?q.pz:live();
const optMap=P=>Object.fromEntries(P.options.map(o=>[o.id,o]));
const teamUnit=(o,P)=>ROLES.reduce((s,r)=>s+(o.h[r]||0)*(P.rates[r]||0),0)+(o.inhouse||0);
const isItemOpt=o=>o.unit==="per minute"||o.unit==="per deliverable";
function calc(q){
  const P=pz(q),M=optMap(P),st=P.settings,fx=(P.fx[q.currency]||{rate:1}).rate;
  const gT=st.gmTeam,gV=st.gmVendor;const hours={Content:0,Design:0,Media:0,QA:0,PM:0};const byOpt={};const missing=[];
  const add=(o,units,acc)=>{const t=units*teamUnit(o,P),v=units*(o.vendor||0);acc.team+=t;acc.vendor+=v;ROLES.forEach(r=>hours[r]+=units*(o.h[r]||0));
    const b=byOpt[o.id]||(byOpt[o.id]={o,team:0,vendor:0,units:0});b.team+=t;b.vendor+=v;b.units+=units};
  const items=q.items.map(it=>{const acc={team:0,vendor:0},warn=[],inc=[],lines=[];const n=+it.count||0,m=+it.minutes||0;let vid=0,anyMin=false,on=0;
    for(const [id,sh] of Object.entries(it.opts||{})){const o=M[id];if(!o){missing.push(id);continue}if(!(sh>0))continue;on++;
      const units=o.unit==="per minute"?n*m*sh:n;if(o.unit==="per minute")anyMin=true;if(/video/i.test(o.group))vid+=sh;
      {const t0=acc.team,v0=acc.vendor;add(o,units,acc);const lt=acc.team-t0,lv=acc.vendor-v0;lines.push({o,units,sh,price:lt/(1-gT)+lv/(1-gV)})}inc.push(o.wording+(o.unit==="per minute"?` (${n>1?n+" × ":""}${r0(m*sh*10)/10} min)`:n>1?` × ${n}`:""))}
    if(!it.name.trim())warn.push("Give this deliverable a name");if(!on)warn.push("Pick at least one option");
    if(!n)warn.push("Add how many");if(anyMin&&!m)warn.push("Add the minutes");if(vid>1.0001)warn.push(`Video options add up to ${Math.round(vid*100)}% of the minutes (max 100%)`);
    const cost=acc.team+acc.vendor,price=acc.team/(1-gT)+acc.vendor/(1-gV);
    return {it,...acc,cost,price,margin:price?(price-cost)/price:null,warn,inc,lines}});
  const xacc={team:0,vendor:0};const extras=[];
  for(const [id,qty] of Object.entries(q.extras||{})){const o=M[id];if(!o||!(qty>0))continue;const b={team:0,vendor:0};add(o,qty,b);xacc.team+=b.team;xacc.vendor+=b.vendor;
    extras.push({o,qty,cost:b.team+b.vendor,price:b.team/(1-gT)+b.vendor/(1-gV)})}
  hours.PM=(+q.pmPct||0)*(+q.pmMonths||0)*st.hoursPerMonth;const pmCost=hours.PM*(P.rates.PM||0),pmPrice=pmCost/(1-gT);
  const team=items.reduce((s,x)=>s+x.team,0)+xacc.team+pmCost,vendor=items.reduce((s,x)=>s+x.vendor,0)+xacc.vendor;
  const cost=team+vendor,price=team/(1-gT)+vendor/(1-gV),disc=+q.discount||0,after=price*(1-disc),margin=after?(after-cost)/after:null;
  const warnN=items.reduce((s,x)=>s+x.warn.length,0);const needs=price>0&&(margin<st.minMargin-1e-9||disc>st.maxDiscount+1e-9);
  let status=!price?{c:"neu",t:"Add deliverables"}:warnN?{c:"fix",t:"Fix the warnings"}:needs&&!q.approved?{c:"appr",t:"Needs manager approval"}:needs?{c:"ok",t:"Approved by manager"}:{c:"ok",t:"Ready to send"};
  return {P,fx,items,extras,pm:{hours:hours.PM,cost:pmCost,price:pmPrice},team,vendor,cost,price,disc,after,margin,hours,byOpt,needs,status,warnN,missing:[...new Set(missing)],
    teamPrice:team/(1-gT),vendorPrice:vendor/(1-gV)};
}
const sig=q=>JSON.stringify([q.items.map(i=>[i.count,i.minutes,i.opts]),q.extras,q.pmPct,q.pmMonths,q.discount,q.currency]);

/* ---------- quotes model ---------- */
function newQuote(){const d=new Date();
  return {id:`Q-${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,"0")}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,v:0,
    client:"",opp:"",currency:"AED",date:today(),pmPct:0.1,pmMonths:2,discount:0,status:"Draft",approved:null,notes:"",
    items:[{uid:uidGen(),name:"",count:1,minutes:60,opts:{}}],extras:{},preparedBy:PREP||S.user,createdAt:new Date().toISOString(),updatedAt:null,updatedBy:"",history:[]}}
const PRESETS=[["Instructor-led course",{"instructor-led-video":.8,"interactive-activities":.1,"assessments-quizzes":.1,"learning-strategy":1}],
  ["Animated course",{"animated-video-in-house":.9,"assessments-quizzes":.1,"learning-strategy":1}],
  ["AI video",{"ai-generated-video":1}],
  ["Interactive e-learning",{"interactive-content-scorm":.6,"interactive-activities":.3,"assessments-quizzes":.1,"voice-over-one-language":1}],
  ["Drama scenario",{"drama-video-real-shooting":1}]];

/* ---------- views ---------- */
function setView(v){S.view=v;$$(".tab").forEach(b=>b.setAttribute("aria-selected",b.dataset.v===v));$$(".view").forEach(x=>x.hidden=x.id!=="v-"+v);
  $("#tabEdit").textContent=S.q&&S.q.v?`Quote ${S.q.id}`:S.q?"New quote":"New quote";render();scrollTo(0,0)}
function render(){if(!S.d)return;renderSync();if(S.view==="quotes")vQuotes();if(S.view==="edit")vEdit();if(S.view==="prices")vPrices();
  $("#foot").innerHTML=`Prices from the Excel price list${S.d.sourceModified?` · Excel saved ${fD(S.d.sourceModified)}`:""}${S.d.problems?.length?` · <b style="color:var(--bad)">${S.d.problems.length} price list problem(s): ${esc(S.d.problems.join(" · "))}</b>`:""}`}
function renderSync(){const st=S.status||{};const t=st.checkedAt?new Date(st.checkedAt):null;
  $("#sync").innerHTML=S.busy?`<span class="pill stale"><span class="dot"></span>${esc(S.busyMsg||"Refreshing…")}</span>`:
    st.ok===false?`<span class="pill stale" title="${esc(st.message)}"><span class="dot"></span>Price sync problem</span>`:
    `<span class="pill live" title="${esc(st.message||"")}"><span class="dot"></span>Prices ${t?relTime(t):""}</span>`}

/* quotes list */
async function loadQuotes(){
  if(!S.token){S.qLoaded=true;return}
  const r=await fetch(`${api()}/contents/costing/quotes?ref=main&t=${Date.now()}`,{headers:ghHeaders(false),cache:"no-store"});
  if(r.status===404){S.quotes=[];S.qLoaded=true;return}if(!r.ok)throw new Error("GitHub answered "+r.status);
  const files=(await r.json()).filter(f=>f.name.endsWith(".enc"));const cache=new Map(S.quotes.map(q=>[q._sha,q]));
  S.quotes=(await Promise.all(files.map(async f=>{if(cache.has(f.sha))return cache.get(f.sha);
    try{const b=await getJSON(`${api()}/contents/${f.path}?ref=main&t=${Date.now()}`,{headers:ghHeaders(true)});const q=await decryptJSON(b);q._sha=f.sha;return q}catch(e){return null}}))).filter(Boolean);
  S.qLoaded=true;
}
function vQuotes(){
  const el=$("#v-quotes");
  if(!S.qLoaded){el.innerHTML=`<div class="skel" style="height:300px"></div>`;return}
  const Q=S.quotes.map(q=>({q,c:calc(q)}));const yr=String(new Date().getFullYear());
  const usd=x=>x.c.after,open=Q.filter(x=>x.q.status==="Draft"||x.q.status==="Sent"),won=Q.filter(x=>x.q.status==="Won"&&(x.q.date||"").startsWith(yr));
  const appr=Q.filter(x=>x.c.status.c==="appr");const mAvg=Q.filter(x=>x.c.after>0);const wm=mAvg.reduce((s,x)=>s+x.c.after,0);
  const decided=Q.filter(x=>x.q.status==="Won"||x.q.status==="Lost");
  const kp=(k,v,d)=>`<div class="kpi"><span class="k">${k}</span><span class="v">${v}</span><span class="d">${d}</span></div>`;
  const qs=S.qs.toLowerCase();
  const rows=Q.filter(x=>(!S.qst||x.q.status===S.qst||(S.qst==="appr"&&x.c.status.c==="appr"))&&(!qs||[x.q.id,x.q.client,x.q.opp,x.q.preparedBy].join(" ").toLowerCase().includes(qs)))
    .sort((a,b)=>(b.q.updatedAt||"").localeCompare(a.q.updatedAt||""));
  el.innerHTML=`
  <div class="vh"><div><h2>Quotes</h2><div class="sub">Every quote saved from this site, with its versions.</div></div>
    <div class="ctl"><button class="btn red" id="newQ">+ New quote</button></div></div>
  ${S.token?"":`<div class="banner bad">Saving is off: this site has no GitHub token. Ask the PMO.</div>`}
  <div class="kpis">${kp("Open pipeline",fUSD(open.reduce((s,x)=>s+usd(x),0)),`${open.length} draft or sent`)}${kp("Won this year",fUSD(won.reduce((s,x)=>s+usd(x),0)),`${won.length} quote(s)`)}
    ${kp("Win rate",decided.length?pct(decided.filter(x=>x.q.status==="Won").length/decided.length):"—",`${decided.length} decided`)}
    ${kp("Average margin",wm?pct(mAvg.reduce((s,x)=>s+x.c.margin*x.c.after,0)/wm):"—","after discount, value-weighted")}
    ${kp("Waiting for approval",appr.length,appr.length?"margin or discount outside the rules":"none")}</div>
  <div class="card"><div class="card-h"><div><h2>All quotes</h2><div class="sub">${rows.length} of ${Q.length}. Values in USD after discount.</div></div>
    <div class="ctl"><input type="search" id="qs" placeholder="Search client, opportunity, ID…" value="${esc(S.qs)}">
    <select id="qst"><option value="">All statuses</option>${STATUSES.map(s=>`<option ${S.qst===s?"selected":""}>${s}</option>`).join("")}<option value="appr" ${S.qst==="appr"?"selected":""}>Needs approval</option></select></div></div>
  ${rows.length?`<div class="tbl-wrap"><table class="qtbl"><thead><tr><th>ID</th><th>Client</th><th>Opportunity</th><th class="r">Value (USD)</th><th class="r">Client currency</th><th class="r">Margin</th><th>Status</th><th>Prepared by</th><th>Updated</th></tr></thead><tbody>
    ${rows.map(x=>`<tr data-id="${esc(x.q.id)}"><td><b>${esc(x.q.id)}</b> <span class="muted">v${x.q.v}</span></td><td class="wrapc">${esc(x.q.client)}</td><td class="wrapc">${esc(x.q.opp)}</td>
      <td class="r">${fUSD(x.c.after)}</td><td class="r">${esc(x.q.currency)} ${fN(x.c.after*x.c.fx)}</td><td class="r"><b style="color:${x.c.margin<x.c.P.settings.minMargin?"var(--bad)":"inherit"}">${pct(x.c.margin)}</b></td>
      <td><span class="chip ${x.q.status==="Won"?"good":x.q.status==="Lost"?"bad":x.q.status==="Sent"?"warn":""}">${esc(x.q.status)}</span>${x.c.status.c==="appr"?` <span class="chip bad">Needs approval</span>`:""}</td>
      <td>${esc(x.q.preparedBy)}</td><td>${x.q.updatedAt?fD(x.q.updatedAt):"—"}</td></tr>`).join("")}</tbody></table></div>`
    :`<div class="empty">${Q.length?"No quotes match.":"No quotes yet. Press “New quote” to build the first one."}</div>`}</div>`;
  $("#newQ").onclick=()=>openQuote(newQuote());
  $("#qs").oninput=e=>{S.qs=e.target.value;const p=e.target.selectionStart;vQuotes();const i=$("#qs");i.focus();i.setSelectionRange(p,p)};
  $("#qst").onchange=e=>{S.qst=e.target.value;vQuotes()};
  $$(".qtbl tbody tr").forEach(tr=>tr.onclick=()=>{const q=S.quotes.find(x=>x.id===tr.dataset.id);if(q)openQuote(structuredClone(q),q._sha)});
}
function openQuote(q,sha=null){if(S.dirty&&S.q&&!confirm("You have unsaved changes. Leave this quote anyway?"))return;
  delete q._sha;S.q=q;S.sha=sha;S.dirty=false;setView("edit")}

/* editor */
function vEdit(){
  const el=$("#v-edit");if(!S.q){S.q=newQuote()}
  const q=S.q,c=calc(q),P=c.P,st=P.settings,M=optMap(P),cur=q.currency,fx=c.fx,locked=q.status!=="Draft";
  const groups=[];P.options.filter(isItemOpt).forEach(o=>{let g=groups.find(x=>x.g===o.group);if(!g)groups.push(g={g:o.group,o:[]});g.o.push(o)});
  const unitPrice=o=>{const t=teamUnit(o,P);return (t/(1-st.gmTeam)+(o.vendor||0)/(1-st.gmVendor))*fx};
  const curOpts=Object.keys(P.fx).map(k=>`<option ${k===cur?"selected":""}>${k}</option>`).join("");
  const ro=locked?"disabled":"";
  const itemHTML=(x,i)=>{const it=x.it;return `<div class="item" data-i="${i}">
    <div class="item-h">
      <label class="fld name">Deliverable ${i+1}<input class="inp" data-f="name" value="${esc(it.name)}" placeholder="e.g. Leadership course" ${ro}></label>
      <label class="fld">How many<input class="inp num" type="number" min="0" step="1" data-f="count" value="${esc(it.count)}" ${ro}></label>
      <label class="fld">Minutes each<input class="inp num" type="number" min="0" step="1" data-f="minutes" value="${esc(it.minutes)}" ${ro}></label>
      <div class="item-p"><b>${cur} ${fN(x.price*fx)}</b><span>margin ${pct(x.margin)}</span></div>
    </div>
    ${locked?"":`<div class="presets">Start from: ${PRESETS.map(([n],k)=>`<button type="button" data-preset="${k}">${n}</button>`).join("")}<span style="flex:1"></span><button class="del" type="button" data-del="${i}">Remove</button></div>`}
    ${groups.map(g=>`<div class="ogroup"><span>${esc(g.g)}${g.g==="Video"?' <i class="hint">· tick the video types, then set what % of the minutes each one covers (together up to 100%)</i>':g.g==="Language"||g.g==="Talent"?' <i class="hint">· applies to the minutes you set</i>':""}</span><div class="opts">${g.o.map(o=>{const sh=it.opts[o.id];const on=sh>0;
      return `<div class="opt ${on?"on":""}" data-opt="${esc(o.id)}" role="checkbox" aria-checked="${on}" tabindex="0" title="${esc(o.source)}"><span class="ck"></span>${esc(o.name)}
      ${on&&o.unit==="per minute"?`<span class="sh"><input type="number" min="1" max="100" step="5" data-sh="${esc(o.id)}" value="${r0(sh*100)}" ${ro} aria-label="Percent of minutes">%</span>`:""}
      <span class="muted" style="font-weight:500;font-size:11.5px">${cur} ${fN(unitPrice(o))}/${o.unit==="per minute"?"min":"each"}</span></div>`}).join("")}</div></div>`).join("")}
    ${x.lines.length?`<div class="brk"><div class="brk-h">How this price is calculated</div>${x.lines.map(l=>{const pm=l.o.unit==="per minute";const up=l.units?l.price/l.units:0;
      return `<div class="brk-r"><span>${esc(l.o.name)}${pm&&l.sh<1?` <em>${r0(l.sh*100)}% of ${it.minutes} min</em>`:""}</span><span class="muted">${pm?`${r0(l.units*10)/10} min`:`${r0(l.units)}`} × ${cur} ${fN(up*fx)}</span><b>${cur} ${fN(l.price*fx)}</b></div>`}).join("")}
      <div class="brk-r t"><span>Total for this deliverable</span><span></span><b>${cur} ${fN(x.price*fx)}</b></div></div>`:""}
    ${x.warn.length?`<div class="warns">${x.warn.map(w=>`<div>⚠ ${esc(w)}</div>`).join("")}</div>`:""}
  </div>`};
  const extrasOpts=P.options.filter(o=>!isItemOpt(o));
  el.innerHTML=`
  <div class="vh"><div><h2>${q.v?`${esc(q.id)} · v${q.v}`:"New quote"}</h2><div class="sub">${q.v?`Prepared by ${esc(q.preparedBy)} · last saved ${fD(q.updatedAt)} by ${esc(q.updatedBy)}`:"Pick the options for each deliverable. Prices update as you go."}</div></div>
    <div class="ctl"><button class="btn ghost" id="backQ">← All quotes</button></div></div>
  ${locked?`<div class="banner info">This quote is <b>${esc(q.status)}</b>, so its prices are frozen as they were when saved. Set it back to Draft to edit with today's price list.</div>`:""}
  ${c.missing.length?`<div class="banner warn">Some options in this quote are no longer in the price list and were left out: ${esc(c.missing.join(", "))}.</div>`:""}
  <div class="ed"><div style="display:flex;flex-direction:column;gap:14px;min-width:0">
    <div class="card"><div class="card-h"><div><h2>Client &amp; project</h2></div></div>
      <div class="form">
        <label class="fld">Client<input class="inp" data-q="client" value="${esc(q.client)}" placeholder="Company name" ${ro}></label>
        <label class="fld">Opportunity<input class="inp" data-q="opp" value="${esc(q.opp)}" placeholder="e.g. Leadership academy 2027" ${ro}></label>
        <label class="fld">Client currency<select class="inp" data-q="currency" ${ro}>${curOpts}</select><small>1 USD = ${fx} ${cur}</small></label>
        <label class="fld">Quote date<input class="inp" type="date" data-q="date" value="${esc(q.date)}" ${ro}></label>
        <label class="fld">PM time (% of one person)<input class="inp" type="number" min="0" max="100" step="5" data-q="pmPct" data-pct="1" value="${r0(q.pmPct*100)}" ${ro}><small>${fN(c.pm.hours)} hours</small></label>
        <label class="fld">Project length (months)<input class="inp" type="number" min="0" step="0.5" data-q="pmMonths" value="${esc(q.pmMonths)}" ${ro}></label>
        <label class="fld">Discount %<input class="inp" type="number" min="0" max="100" step="1" data-q="discount" data-pct="1" value="${r0(q.discount*1000)/10}" ${ro}><small>max ${pct(st.maxDiscount)} without approval</small></label>
      </div></div>
    ${c.items.map(itemHTML).join("")}
    ${locked?"":`<button class="btn ghost" id="addItem" style="align-self:flex-start">+ Add deliverable</button>`}
    <div class="card"><div class="card-h"><div><h2>Project extras</h2><div class="sub">Studio days, travel, presenters, AI tools: for the whole project.</div></div></div>
      ${extrasOpts.map(o=>{const v=q.extras[o.id]||0;return `<div class="xrow"><div class="nm">${esc(o.name)}<small>${cur} ${fN(unitPrice(o))} ${esc(o.unit)}</small></div>
        <div class="step"><button type="button" data-x="${esc(o.id)}" data-d="-1" ${ro} aria-label="Less">−</button><input type="number" min="0" data-xi="${esc(o.id)}" value="${v}" ${ro} aria-label="Quantity"><button type="button" data-x="${esc(o.id)}" data-d="1" ${ro} aria-label="More">+</button></div></div>`}).join("")}
    </div>
    <div class="card"><div class="card-h"><div><h2>Notes for the client</h2><div class="sub">Optional. Printed on the quotation.</div></div></div>
      <textarea class="inp" data-q="notes" rows="3" style="width:100%" ${ro}>${esc(q.notes)}</textarea></div>
  </div>
  <aside class="side">
    <div class="card tot"><div class="muted" style="font-size:12px;font-weight:700">TOTAL FOR THE CLIENT</div>
      <div class="big">${cur} ${fN(c.after*fx)}</div><div class="muted" style="font-size:12.5px;margin-bottom:8px">${fUSD(c.after)}${c.disc?` after ${pct(c.disc)} discount`:""}</div>
      <div class="row"><span>Price before discount</span><b>${cur} ${fN(c.price*fx)}</b></div>
      <div class="row"><span>Our cost</span><b>${cur} ${fN(c.cost*fx)}</b></div>
      <div class="row"><span>Profit</span><b>${cur} ${fN((c.after-c.cost)*fx)}</b></div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:10px"><span style="font-size:13px;color:var(--fg-2)">Margin after discount</span><b style="font-size:20px;color:${c.margin<st.minMargin?"var(--bad)":"var(--good)"}">${pct(c.margin)}</b></div>
      <div class="mbar"><i style="width:${Math.max(0,Math.min(100,(c.margin||0)*100))}%;background:${c.margin<st.minMargin?"var(--bad)":"var(--good)"}"></i><em style="left:${st.minMargin*100}%" title="Minimum ${pct(st.minMargin)}"></em></div>
      <div class="muted" style="font-size:11.5px">Line = minimum ${pct(st.minMargin)}</div>
      <div style="margin-top:12px"><span class="stat ${c.status.c}">${esc(c.status.t)}</span></div>
      ${c.needs&&S.role==="manager"&&!locked?`<div style="margin-top:10px">${q.approved?`<div class="muted" style="font-size:12px">Approved by ${esc(q.approved.by)} · ${fD(q.approved.at)}</div><button class="link" id="unapprove">Remove approval</button>`:`<button class="btn" id="approve" style="width:100%">Approve this quote</button>`}</div>`:""}
    </div>
    <div class="card"><div class="acts">
      <button class="btn red full" id="save" ${S.token?"":"disabled"}>${S.dirty||!q.v?"Save quote":"Saved ✓"}</button>
      <button class="btn ghost" id="pQuote" ${c.status.c==="appr"||!c.price?"disabled title='Needs manager approval first'":""}>Client quotation PDF</button>
      <button class="btn ghost" id="pGM" ${c.price?"":"disabled"}>GM sheet PDF</button>
      <button class="btn ghost" id="xGM" ${c.price?"":"disabled"}>GM sheet Excel</button>
      <button class="btn ghost" id="dup">Duplicate</button>
      <label class="fld full" style="margin-top:4px">Status<select class="inp" id="qstatus">${STATUSES.map(s=>`<option ${q.status===s?"selected":""}>${s}</option>`).join("")}</select></label>
    </div></div>
    <div class="card"><h2 style="font-size:13px;margin:0 0 8px">Team time</h2>
      ${["Content","Design","Media","QA","PM"].map(r=>`<div class="row" style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0"><span class="muted">${r}</span><b>${fN(c.hours[r])} h · ${(Math.round(c.hours[r]/8*10)/10)} days</b></div>`).join("")}
    </div>
  </aside></div>`;
  wireEdit();
}
function changed(rerender=true){S.dirty=true;if(S.q.approved&&S.q.approved.sig!==sig(S.q))S.q.approved=null;if(rerender){const y=scrollY;vEdit();scrollTo(0,y)}}
function wireEdit(){
  const q=S.q;
  $("#backQ").onclick=()=>{if(S.dirty&&!confirm("You have unsaved changes. Leave anyway?"))return;S.dirty=false;setView("quotes")};
  $$("[data-q]").forEach(i=>i.onchange=()=>{const k=i.dataset.q;let v=i.value;if(["pmPct","pmMonths","discount"].includes(k)){v=Math.max(0,+v||0);if(i.dataset.pct)v=Math.min(100,v)/100}q[k]=v;changed()});
  $$(".item").forEach(card=>{const i=+card.dataset.i,it=q.items[i];
    card.querySelectorAll("[data-f]").forEach(inp=>inp.onchange=()=>{const f=inp.dataset.f;it[f]=f==="name"?inp.value:Math.max(0,+inp.value||0);changed()});
    card.querySelectorAll(".opt").forEach(o=>{const tog=e=>{if(q.status!=="Draft"||e.target.tagName==="INPUT")return;const id=o.dataset.opt;if(it.opts[id]>0)delete it.opts[id];else it.opts[id]=1;changed()};
      o.onclick=tog;o.onkeydown=e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();tog(e)}}});
    card.querySelectorAll("[data-sh]").forEach(inp=>{inp.onclick=e=>e.stopPropagation();inp.onchange=()=>{const v=Math.max(1,Math.min(100,+inp.value||100));it.opts[inp.dataset.sh]=v/100;changed()}});
    card.querySelectorAll("[data-preset]").forEach(b=>b.onclick=()=>{const [nm,o]=PRESETS[+b.dataset.preset];const M=optMap(live());it.opts=Object.fromEntries(Object.entries(o).filter(([k])=>M[k]));
      if(!it.name.trim())it.name=nm;changed()});
    card.querySelector("[data-del]")?.addEventListener("click",()=>{if(q.items.length===1){q.items[0]={uid:uidGen(),name:"",count:1,minutes:60,opts:{}}}else q.items.splice(i,1);changed()});
  });
  $("#addItem")?.addEventListener("click",()=>{q.items.push({uid:uidGen(),name:"",count:1,minutes:30,opts:{}});changed();setTimeout(()=>{const c=$$(".item");c[c.length-1]?.scrollIntoView({behavior:"smooth",block:"center"});c[c.length-1]?.querySelector("input")?.focus()},50)});
  $$("[data-x]").forEach(b=>b.onclick=()=>{const id=b.dataset.x;q.extras[id]=Math.max(0,(q.extras[id]||0)+ +b.dataset.d);if(!q.extras[id])delete q.extras[id];changed()});
  $$("[data-xi]").forEach(i=>i.onchange=()=>{const v=Math.max(0,+i.value||0);if(v)q.extras[i.dataset.xi]=v;else delete q.extras[i.dataset.xi];changed()});
  $("#qstatus").onchange=e=>{const s=e.target.value;if(s!=="Draft"&&q.status==="Draft"){q.pz=snapshotPricing(q)}q.status=s;changed()};
  $("#approve")?.addEventListener("click",()=>{q.approved={by:PREP||S.user,at:new Date().toISOString(),sig:sig(q)};changed();toast("Approved. Save the quote to keep it.")});
  $("#unapprove")?.addEventListener("click",()=>{q.approved=null;changed()});
  $("#save").onclick=saveQuote;
  $("#pQuote").onclick=()=>printDoc(quoteDoc());
  $("#pGM").onclick=()=>printDoc(gmDoc());
  $("#xGM").onclick=gmExcel;
  $("#dup").onclick=()=>{const n=newQuote();const keep=structuredClone(q);Object.assign(n,{client:keep.client,opp:keep.opp+" (copy)",currency:keep.currency,pmPct:keep.pmPct,pmMonths:keep.pmMonths,
    discount:keep.discount,items:keep.items,extras:keep.extras,notes:keep.notes});S.q=n;S.sha=null;S.dirty=true;setView("edit");toast("Copied into a new draft. Prices use today's price list.")};
}
function snapshotPricing(q){const P=live();const used=new Set([...q.items.flatMap(i=>Object.keys(i.opts||{})),...Object.keys(q.extras||{})]);
  return {rates:P.rates,settings:P.settings,fx:{[q.currency]:P.fx[q.currency]||{rate:1}},options:P.options.filter(o=>used.has(o.id)),at:new Date().toISOString()}}

/* save */
async function saveQuote(){
  const q=S.q;if(!S.token){toast("Saving is off on this site");return}
  if(!q.client.trim()){toast("Add the client name first");$('[data-q="client"]')?.focus();return}
  if(!PREP){const n=prompt("Your name (shown as “Prepared by” on quotes):",S.user);if(!n)return;PREP=n.trim();ls.set("cost.prep",PREP);$("#who .avatar").textContent=initials(PREP);$("#who .hide-sm").textContent=PREP+(S.role==="manager"?" · manager":"");if(!q.v)q.preparedBy=PREP}
  const btn=$("#save");btn.disabled=true;btn.textContent="Saving…";
  const c=calc(q);q.v=(q.v||0)+1;q.updatedAt=new Date().toISOString();q.updatedBy=PREP;
  q.summary={after:c.after,cur:q.currency,fx:c.fx,margin:c.margin,cost:c.cost};
  q.history=[...(q.history||[]),{v:q.v,at:q.updatedAt,by:PREP,status:q.status,after:Math.round(c.after)}].slice(-50);
  if(q.status!=="Draft"&&!q.pz)q.pz=snapshotPricing(q);
  try{
    const body={message:`Quote ${q.id} v${q.v} (${q.status}) by ${PREP}`,content:btoa(JSON.stringify(await encryptJSON(q))),branch:"main"};if(S.sha)body.sha=S.sha;
    let r=await fetch(`${api()}/contents/costing/quotes/${q.id}.enc`,{method:"PUT",headers:{...ghHeaders(false),"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(r.status===409||r.status===422){const g=await fetch(`${api()}/contents/costing/quotes/${q.id}.enc?ref=main&t=${Date.now()}`,{headers:ghHeaders(false),cache:"no-store"});
      if(g.ok){const cur=await g.json();const other=await decryptJSON(JSON.parse(atob(cur.content.replace(/\n/g,""))));
        if(other.updatedBy!==PREP||other.v>=q.v){q.v--;throw new Error(`${other.updatedBy||"Someone"} saved this quote (v${other.v}) while you were editing. Open it again from the list to see their changes.`)}
        body.sha=cur.sha;r=await fetch(`${api()}/contents/costing/quotes/${q.id}.enc`,{method:"PUT",headers:{...ghHeaders(false),"Content-Type":"application/json"},body:JSON.stringify(body)})}}
    if(!r.ok){q.v--;throw new Error(r.status===401||r.status===403?"The site's GitHub token has expired or can't save. Ask the PMO.":"GitHub answered "+r.status)}
    const res=await r.json();S.sha=res.content.sha;S.dirty=false;
    const saved=structuredClone(q);saved._sha=S.sha;S.quotes=[saved,...S.quotes.filter(x=>x.id!==q.id)];toast(`Saved ${q.id} v${q.v}`);
  }catch(e){toast(e.message||String(e))}
  const y=scrollY;vEdit();scrollTo(0,y);
}

/* price list */
function vPrices(){
  const P=live(),st=P.settings,cur=S.pcur||"USD",fx=(P.fx[cur]||{rate:1}).rate;const el=$("#v-prices");
  const groups=[];P.options.forEach(o=>{let g=groups.find(x=>x.g===o.group);if(!g)groups.push(g={g:o.group,o:[]});g.o.push(o)});
  el.innerHTML=`<div class="vh"><div><h2>Price list</h2><div class="sub">Read-only. The PMO edits it in the Excel price list; changes show up here within the hour (or press Refresh prices).</div></div>
    <div class="ctl"><label class="fld" style="flex-direction:row;align-items:center;gap:8px">Show prices in<select class="inp" id="pcur">${Object.keys(P.fx).map(k=>`<option ${k===cur?"selected":""}>${k}</option>`).join("")}</select></label></div></div>
  <div class="kpis">${["Content","Design","Media","QA","PM"].map(r=>`<div class="kpi"><span class="k">${r} hour</span><span class="v">${fUSD2(P.rates[r])}</span><span class="d">cost per hour</span></div>`).join("")}
   <div class="kpi"><span class="k">Margins</span><span class="v">${pct(st.gmTeam)} / ${pct(st.gmVendor)}</span><span class="d">team time / vendors · minimum ${pct(st.minMargin)}</span></div></div>
  <div class="card"><div class="tbl-wrap"><table class="ptbl"><thead><tr><th>Option</th><th>Unit</th><th class="r">Team hours</th><th class="r">Cost (USD)</th><th class="r">Price (${cur})</th><th>Where the number comes from</th></tr></thead><tbody>
  ${groups.map(g=>`<tr class="g"><td colspan="6">${esc(g.g)}</td></tr>`+g.o.map(o=>{const t=teamUnit(o,P),cost=t+(o.vendor||0),price=t/(1-st.gmTeam)+(o.vendor||0)/(1-st.gmVendor);const h=ROLES.reduce((s,r)=>s+(o.h[r]||0),0);
    return `<tr><td><b>${esc(o.name)}</b></td><td>${esc(o.unit)}</td><td class="r">${h?Math.round(h*100)/100:"—"}</td><td class="r">${fUSD2(cost)}</td><td class="r"><b>${cur} ${(Math.round(price*fx*100)/100).toLocaleString("en-US")}</b></td><td class="muted" style="font-size:12px">${esc(o.source)}</td></tr>`}).join("")).join("")}
  </tbody></table></div></div>
  <div class="card"><h2>Exchange rates</h2><div class="sub">Units per 1 USD</div><div class="kpis" style="margin-top:10px">${Object.entries(P.fx).map(([k,v])=>`<div class="kpi"><span class="k">${k}</span><span class="v">${v.rate}</span><span class="d">${esc(v.note||"")}</span></div>`).join("")}</div></div>`;
  $("#pcur").onchange=e=>{S.pcur=e.target.value;vPrices()};
}

/* documents */
function printDoc(html){$("#print").innerHTML=html;const imgs=[...$("#print").querySelectorAll("img")];Promise.all(imgs.map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>setTimeout(()=>print(),60))}
const LOGO_DARK=()=>LOGO; // white logo is for the dark masthead; the print header uses text + red rule
function docHead(title,q,extra=""){return `<div class="ph"><div><div style="font-size:22px;font-weight:900;color:#FF0000;letter-spacing:-.02em">almentor</div><h1>${title}</h1>${extra}</div>
  <div style="text-align:right;font-size:11px;color:#555">${esc(q.id)} · v${q.v||1}<br>${fD(q.date)}</div></div>`}
function quoteDoc(){
  const q=S.q,c=calc(q),cur=q.currency,fx=c.fx,P=c.P;const m=v=>fN(v*fx);
  const lines=c.items.filter(x=>x.price>0);const proj=c.pm.price+c.extras.reduce((s,x)=>s+x.price,0);
  const sub=lines.reduce((s,x)=>s+Math.round(x.price*fx),0)+Math.round(proj*fx);const dsc=Math.round(sub*c.disc);
  return docHead("Quotation",q)+`<div class="meta"><b>Client</b><span>${esc(q.client)}</span><b>Currency</b><span>${esc(cur)}</span>
    <b>Project</b><span>${esc(q.opp)}</span><b>Valid until</b><span>${fD(addDays(q.date,P.settings.validDays||30))}</span>
    <b>Prepared by</b><span>${esc(q.preparedBy)}</span><b></b><span></span></div>
  <table><thead><tr><th style="width:24px">#</th><th>Deliverable</th><th>What's included</th><th class="r" style="width:42px">Qty</th><th class="r" style="width:90px">Total (${esc(cur)})</th></tr></thead><tbody>
  ${lines.map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.it.name)}</b>${x.it.minutes?`<br><span style="color:#666">${x.it.count>1?x.it.count+" × ":""}${x.it.minutes} min</span>`:""}</td><td>${esc(x.inc.join(", "))}</td><td class="r">${x.it.count}</td><td class="r">${m(x.price)}</td></tr>`).join("")}
  ${proj>0?`<tr><td>${lines.length+1}</td><td><b>Project management &amp; production services</b></td><td>${esc(["Project management"+(c.pm.hours?"":""),...c.extras.map(x=>x.o.wording+(x.qty>1?` × ${x.qty}`:""))].join(", "))}</td><td class="r">1</td><td class="r">${fN(proj*fx)}</td></tr>`:""}
  </tbody></table>
  <table class="tots"><tr><td>Subtotal</td><td class="r">${fN(sub)}</td></tr>${dsc?`<tr><td>Discount (${pct(c.disc)})</td><td class="r">−${fN(dsc)}</td></tr>`:""}<tr class="t"><td>Total (${esc(cur)})</td><td class="r">${fN(sub-dsc)}</td></tr></table>
  ${q.notes?`<div class="note"><b>Notes</b><br>${esc(q.notes).replace(/\n/g,"<br>")}</div>`:""}
  <div class="note">Prices exclude VAT and any applicable taxes. Based on the deliverables and durations listed; changes in scope may change the price. Valid until the date above.</div>`;
}
function gmDoc(){
  const q=S.q,c=calc(q),cur=q.currency,fx=c.fx,P=c.P,st=P.settings;const u=fUSD;
  const row=(n,co,pr)=>`<tr><td>${n}</td><td class="r">${u(co)}</td><td class="r">${u(pr)}</td><td class="r">${u(pr-co)}</td><td class="r">${pct(pr?(pr-co)/pr:null)}</td></tr>`;
  return docHead("Gross margin sheet",q,`<div class="conf">INTERNAL · DO NOT SEND TO THE CLIENT</div>`)+`<div class="meta"><b>Client</b><span>${esc(q.client)}</span><b>Status</b><span>${esc(q.status)} · ${esc(c.status.t)}</span>
    <b>Project</b><span>${esc(q.opp)}</span><b>Currency</b><span>${esc(cur)} (1 USD = ${fx})</span><b>Prepared by</b><span>${esc(q.preparedBy)}</span><b>Approved</b><span>${q.approved?esc(q.approved.by)+" · "+fD(q.approved.at):c.needs?"Not yet":"Not needed"}</span></div>
  <h2>Summary (USD)</h2><table><thead><tr><th></th><th class="r">Cost</th><th class="r">Price</th><th class="r">Profit</th><th class="r">Margin</th></tr></thead><tbody>
    ${row("Team time (internal)",c.team,c.teamPrice)}${row("Vendors (external)",c.vendor,c.vendorPrice)}${row("<b>Total before discount</b>",c.cost,c.price)}
    ${row(`<b>Total after ${pct(c.disc)} discount</b>`,c.cost,c.after)}<tr><td><b>Total after discount (${esc(cur)})</b></td><td class="r">${fN(c.cost*fx)}</td><td class="r">${fN(c.after*fx)}</td><td class="r">${fN((c.after-c.cost)*fx)}</td><td class="r">${pct(c.margin)}</td></tr></tbody></table>
  <div class="note" style="margin-top:0">Targets: ${pct(st.gmTeam)} on team time, ${pct(st.gmVendor)} on vendors. Minimum after discount ${pct(st.minMargin)}. Margin = profit ÷ price.</div>
  <h2>By deliverable</h2><table><thead><tr><th>Deliverable</th><th class="r">Qty</th><th class="r">Minutes</th><th class="r">Team cost</th><th class="r">Vendor cost</th><th class="r">Price</th><th class="r">Margin</th></tr></thead><tbody>
    ${c.items.map(x=>`<tr><td>${esc(x.it.name)}<br><span style="color:#666">${esc(x.inc.join(", "))}</span></td><td class="r">${x.it.count}</td><td class="r">${x.it.minutes}</td><td class="r">${u(x.team)}</td><td class="r">${u(x.vendor)}</td><td class="r">${u(x.price)}</td><td class="r">${pct(x.margin)}</td></tr>`).join("")}
    ${c.extras.map(x=>`<tr><td>${esc(x.o.name)} × ${x.qty}</td><td class="r">${x.qty}</td><td class="r">—</td><td class="r">${u(x.cost-x.qty*(x.o.vendor||0))}</td><td class="r">${u(x.qty*(x.o.vendor||0))}</td><td class="r">${u(x.price)}</td><td class="r">${pct(x.price?(x.price-x.cost)/x.price:null)}</td></tr>`).join("")}
    <tr><td>Project management (${fN(c.pm.hours)} h)</td><td class="r">—</td><td class="r">—</td><td class="r">${u(c.pm.cost)}</td><td class="r">$0</td><td class="r">${u(c.pm.price)}</td><td class="r">${pct(st.gmTeam)}</td></tr></tbody></table>
  <h2>Team hours</h2><table><thead><tr><th>Team</th><th class="r">Hours</th><th class="r">Days</th><th class="r">Rate</th><th class="r">Cost</th></tr></thead><tbody>
    ${["Content","Design","Media","QA","PM"].map(r=>`<tr><td>${r}</td><td class="r">${fN(c.hours[r])}</td><td class="r">${Math.round(c.hours[r]/8*10)/10}</td><td class="r">${fUSD2(P.rates[r])}</td><td class="r">${u(c.hours[r]*P.rates[r])}</td></tr>`).join("")}</tbody></table>
  <h2>By option</h2><table><thead><tr><th>Option</th><th class="r">Units</th><th class="r">Team cost</th><th class="r">Vendor cost</th><th class="r">Total cost</th></tr></thead><tbody>
    ${Object.values(c.byOpt).map(b=>`<tr><td>${esc(b.o.name)}</td><td class="r">${Math.round(b.units*10)/10} ${b.o.unit==="per minute"?"min":esc(b.o.unit.replace("per ",""))+(Math.round(b.units*10)/10===1?"":"s")}</td><td class="r">${u(b.team)}</td><td class="r">${u(b.vendor)}</td><td class="r">${u(b.team+b.vendor)}</td></tr>`).join("")}</tbody></table>
  <div class="note">Generated ${fD(today())} from the almentor price list${q.status!=="Draft"&&q.pz?` (prices frozen on ${fD(q.pz.at)})`:""}.</div>`;
}
async function gmExcel(){
  if(!window.XLSX){toast("Preparing Excel…");await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";s.onload=res;s.onerror=rej;document.head.appendChild(s)}).catch(()=>{})}
  if(!window.XLSX){toast("Couldn't load the Excel library. Use the GM sheet PDF.");return}
  const q=S.q,c=calc(q),P=c.P,R=v=>Math.round(v*100)/100;
  const sum=[["almentor · Gross margin sheet (internal)"],[],["Quote",q.id,"Version",q.v||1],["Client",q.client,"Currency",q.currency],["Opportunity",q.opp,"Rate per USD",c.fx],["Status",q.status,"Approval",c.status.t],[],
    ["","Cost (USD)","Price (USD)","Profit (USD)","Margin"],["Team time",R(c.team),R(c.teamPrice),R(c.teamPrice-c.team),R((c.teamPrice-c.team)/(c.teamPrice||1))],
    ["Vendors",R(c.vendor),R(c.vendorPrice),R(c.vendorPrice-c.vendor),R((c.vendorPrice-c.vendor)/(c.vendorPrice||1))],["Total before discount",R(c.cost),R(c.price),R(c.price-c.cost),R((c.price-c.cost)/(c.price||1))],
    ["Discount",c.disc],["Total after discount",R(c.cost),R(c.after),R(c.after-c.cost),R(c.margin||0)],["Total after discount ("+q.currency+")",R(c.cost*c.fx),R(c.after*c.fx),R((c.after-c.cost)*c.fx),R(c.margin||0)]];
  const del=[["Deliverable","Included","Qty","Minutes","Team cost","Vendor cost","Price (USD)","Price ("+q.currency+")","Margin"],
    ...c.items.map(x=>[x.it.name,x.inc.join(", "),x.it.count,x.it.minutes,R(x.team),R(x.vendor),R(x.price),R(x.price*c.fx),R(x.margin||0)]),
    ...c.extras.map(x=>[x.o.name,"",x.qty,"",R(x.cost-x.qty*(x.o.vendor||0)),R(x.qty*(x.o.vendor||0)),R(x.price),R(x.price*c.fx),R(x.price?(x.price-x.cost)/x.price:0)]),
    ["Project management","",1,"",R(c.pm.cost),0,R(c.pm.price),R(c.pm.price*c.fx),P.settings.gmTeam]];
  const hrs=[["Team","Hours","Days","Rate (USD)","Cost (USD)"],...["Content","Design","Media","QA","PM"].map(r=>[r,R(c.hours[r]),R(c.hours[r]/8),P.rates[r],R(c.hours[r]*P.rates[r])])];
  const wb=XLSX.utils.book_new();[["Summary",sum],["By deliverable",del],["Team hours",hrs]].forEach(([n,a])=>{const ws=XLSX.utils.aoa_to_sheet(a);ws["!cols"]=a[0].map((_,i)=>({wch:i?16:34}));XLSX.utils.book_append_sheet(wb,ws,n)});
  XLSX.writeFile(wb,`${q.id}_GM_v${q.v||1}.xlsx`);
}

/* ---------- data, login, refresh ---------- */
let REPO="almentor-pmo/almentor-pmo.github.io";
const api=()=>"https://api.github.com/repos/"+REPO;
const LSK="almentor.cost.key";
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const ub64=u=>{const a=new Uint8Array(u);let s="";for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s)};
let DKEY=null;
async function sha256hex(t){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function getJSON(url,o={}){const r=await fetch(url,{cache:"no-store",...o});if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}
async function unlock(user,pass){
  const keys=await getJSON("keys.json?t="+Date.now());const ent=keys.users[await sha256hex("almentor-cost:"+user.trim().toLowerCase())];if(!ent)return null;
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);
  const kek=await crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt:b64(ent.salt),iterations:ent.iter},base,{name:"AES-GCM",length:256},false,["decrypt"]);
  try{return {k:await crypto.subtle.decrypt({name:"AES-GCM",iv:b64(ent.iv)},kek,b64(ent.wk)),role:ent.role||"sales"}}catch(e){return null}
}
const decryptJSON=async b=>JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:b64(b.iv)},DKEY,b64(b.ct))));
async function encryptJSON(o){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},DKEY,new TextEncoder().encode(JSON.stringify(o)));return {v:1,iv:ub64(iv),ct:ub64(ct)}}
function ghHeaders(raw){const h={Accept:raw?"application/vnd.github.raw+json":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};if(S.token)h.Authorization="Bearer "+S.token;return h}
async function fetchBundle(fresh){if(fresh){try{return await getJSON(`${api()}/contents/costing/data.enc?ref=main&t=${Date.now()}`,{headers:ghHeaders(true)})}catch(e){}}return getJSON("data.enc?t="+Date.now())}
async function fetchStatus(fresh){if(fresh)return getJSON(`${api()}/contents/costing/status.json?ref=main&t=${Date.now()}`,{headers:ghHeaders(true)});return getJSON("status.json?t="+Date.now())}
async function loadBundle(fresh){const b=await decryptJSON(await fetchBundle(fresh));S.d=b.data;S.status=b.status;S.token=b.token||"";if(b.repo)REPO=b.repo}
async function refreshNow(){
  if(S.busy)return;if(!S.token){toast("Reloading the latest published prices…");loadBundle(false).then(render).catch(()=>toast("Couldn't reach the price list"));return}
  const rid=Math.random().toString(36).slice(2,10)+Date.now().toString(36);S.busy=true;S.busyMsg="Pulling prices from Excel…";renderSync();const t0=Date.now();let done=false;
  try{const r=await fetch(`${api()}/actions/workflows/cost-sync.yml/dispatches`,{method:"POST",headers:{...ghHeaders(false),"Content-Type":"application/json"},body:JSON.stringify({ref:"main",inputs:{request_id:rid}})});
    if(r.status!==204)throw new Error(r.status===401||r.status===403?"The Refresh token has expired or lacks permission":"GitHub answered "+r.status);
    while(Date.now()-t0<240000){await new Promise(r=>setTimeout(r,5000));S.busyMsg="Pulling prices from Excel… "+Math.round((Date.now()-t0)/1000)+"s";renderSync();
      try{const st=await fetchStatus(true);if(st.requestId===rid){done=true;break}}catch(e){}}
  }catch(e){S.busy=false;renderSync();toast(e.message);return}
  S.busy=false;try{await loadBundle(true)}catch(e){}render();
  toast(!done?"GitHub is taking longer than usual. Prices will update when it finishes.":S.status?.ok===false?"Refresh finished with a problem: "+S.status.message:S.status?.message||"Up to date");
}
function setMastH(){document.documentElement.style.setProperty("--mastH",$("#mast").offsetHeight+"px")}
addEventListener("resize",setMastH);setMastH();
addEventListener("beforeunload",e=>{if(S.dirty){e.preventDefault();e.returnValue=""}});
$("#refresh").addEventListener("click",refreshNow);
$$(".tab").forEach(b=>b.onclick=()=>{if(b.dataset.v==="edit"&&!S.q)S.q=newQuote();if(b.dataset.v==="quotes")loadQuotes().then(()=>S.view==="quotes"&&vQuotes()).catch(()=>{});setView(b.dataset.v)});
async function start(rawKey){
  DKEY=await crypto.subtle.importKey("raw",rawKey,"AES-GCM",false,["decrypt","encrypt"]);$("#gate").hidden=true;
  $("#who").innerHTML=`<div class="avatar">${esc(initials(PREP||S.user||"BD"))}</div><span class="hide-sm">${esc(PREP||S.user||"")}${S.role==="manager"?" · manager":""}</span><button class="link" id="signout" type="button">Sign out</button>`;
  $("#signout").onclick=()=>{ls.del(LSK);location.reload()};
  try{await loadBundle(false)}catch(e){if(String(e).includes("OperationError")){ls.del(LSK);location.reload();return}console.error(e);$("#loadmsg").textContent="Couldn't load the price list. Check your connection and reload the page.";return}
  $("#loading").hidden=true;setView("quotes");setMastH();
  try{await loadQuotes()}catch(e){toast("Couldn't load saved quotes: "+e.message);S.qLoaded=true}if(S.view==="quotes")vQuotes();
  setInterval(async()=>{if(S.busy||document.hidden)return;try{const st=await fetchStatus(false);if(st.checkedAt&&st.checkedAt!==S.status?.checkedAt){await loadBundle(false);if(S.view!=="edit")render();else renderSync()}}catch(e){}},5*60000);
  setInterval(()=>{if(S.d)renderSync()},60000);
}
$("#login").addEventListener("submit",async ev=>{ev.preventDefault();const u=$("#u").value,p=$("#pw").value;$("#lerr").textContent="";$("#lbtn").disabled=true;$("#lbtn").textContent="Signing in…";
  try{const r=await unlock(u,p);if(!r){$("#lerr").textContent="That username or password isn't right. Try again.";return}
    S.user=u.trim();S.role=r.role;if($("#keep").checked)ls.set(LSK,JSON.stringify({u:S.user,k:ub64(r.k),role:r.role}));await start(r.k)}
  catch(e){console.error(e);$("#lerr").textContent="Couldn't reach the site. Check your connection and try again."}
  finally{$("#lbtn").disabled=false;$("#lbtn").textContent="Sign in"}});
(async()=>{if(!window.crypto?.subtle){$("#loadmsg").textContent="This browser can't open the site. Use a recent Chrome, Edge, Safari or Firefox.";return}
  const saved=ls.get(LSK);if(saved){try{const o=JSON.parse(saved);S.user=o.u;S.role=o.role||"sales";await start(b64(o.k));return}catch(e){ls.del(LSK)}}
  $("#gate").hidden=false;$("#u").focus()})();
