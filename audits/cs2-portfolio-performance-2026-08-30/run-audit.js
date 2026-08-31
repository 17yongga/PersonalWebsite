'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const puppeteer=require('puppeteer');
const root=__dirname;
const url=pathToFileURL(path.join(root,'fixture.html')).href;
const viewports=[['320x568',320,568,3],['390x844',390,844,3],['430x932',430,932,3],['844x390',844,390,2],['1280x900',1280,900,2]];
(async()=>{
  const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--allow-file-access-from-files']});
  const results=[];
  try{
    for(const [name,width,height,dpr] of viewports){
      const page=await browser.newPage();const errors=[];
      page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
      page.on('pageerror',error=>errors.push(String(error)));
      await page.setViewport({width,height,deviceScaleFactor:dpr,isMobile:width<=430,hasTouch:width<=430});
      await page.goto(url,{waitUntil:'load'});await page.waitForSelector('.cs2-tournament-section');
      const metrics=await page.evaluate(()=>{
        const sections=[...document.querySelectorAll('.cs2-tournament-section')];
        const before=new Map(sections.map(node=>[node.dataset.tournamentKey,node]));
        const unchanged=qaGame.applyEvents(qaEvents);
        const afterSame=new Map([...document.querySelectorAll('.cs2-tournament-section')].map(node=>[node.dataset.tournamentKey,node]));
        const preservedSame=[...before.keys()].every(key=>before.get(key)===afterSame.get(key));
        const first=sections[0];first.classList.add('collapsed');first.querySelector('.cs2-tournament-header')?.setAttribute('aria-expanded','false');
        const changed=structuredClone(qaEvents);changed[0].odds.team1=1.80;
        const changedApplied=qaGame.applyEvents(changed);
        const afterChanged=new Map([...document.querySelectorAll('.cs2-tournament-section')].map(node=>[node.dataset.tournamentKey,node]));
        const keys=[...before.keys()];
        const replacedCount=keys.filter(key=>before.get(key)!==afterChanged.get(key)).length;
        const unchangedCount=keys.filter(key=>before.get(key)===afterChanged.get(key)).length;
        const collapsePreserved=[...afterChanged.values()].some(node=>node.classList.contains('collapsed'));
        const openText=document.getElementById('cs2MyBets').innerText;
        document.querySelector('[data-tab="history"]').click();
        const historyText=document.getElementById('cs2MyBets').innerText;
        const critical=[...document.querySelectorAll('.bet-tab,.cs2-refresh-btn,.cs2-mode-btn')].map(el=>{const r=el.getBoundingClientRect();return{label:el.innerText.trim(),w:+r.width.toFixed(1),h:+r.height.toFixed(1)}});
        const containerStyle=getComputedStyle(document.querySelector('.cs2-betting-container'),'::before');
        const cardStyle=getComputedStyle(document.querySelector('.cs2-event-card'));
        return{
          overflowX:document.documentElement.scrollWidth>innerWidth+1,
          documentWidth:document.documentElement.scrollWidth,
          critical,undersized:critical.filter(item=>item.w<43.5||item.h<43.5),
          sections:sections.length,unchangedReturned:unchanged,preservedSame,changedApplied,replacedCount,unchangedCount,collapsePreserved,
          openNewestFirst:openText.indexOf('NEW-002')<openText.indexOf('OLD-001'),
          historyNewestFirst:historyText.indexOf('NEW-002')<historyText.indexOf('OLD-001'),
          parlayVisible:openText.includes('2-LEG PARLAY'),historyTabSelected:document.querySelector('[data-tab="history"]').getAttribute('aria-selected')==='true',
          status:document.getElementById('cs2PortfolioStatus').dataset.state,summary:document.getElementById('cs2PortfolioSummary').innerText,
          mobileNoiseDisplay:containerStyle.display,eventTransition:cardStyle.transition,backdropFilter:cardStyle.backdropFilter
        };
      });
      await page.screenshot({path:path.join(root,`${name}.png`),fullPage:true});
      results.push({name,metrics,errors});await page.close();
    }
    const report={generatedAt:new Date().toISOString(),results};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));
    const failures=[];
    for(const result of results){const m=result.metrics;if(m.overflowX)failures.push(`${result.name}: overflow`);if(m.undersized.length)failures.push(`${result.name}: undersized critical controls`);if(result.errors.length)failures.push(`${result.name}: console errors`);if(m.unchangedReturned!==false||!m.preservedSame||!m.changedApplied||m.replacedCount!==1||m.unchangedCount!==1||!m.collapsePreserved)failures.push(`${result.name}: keyed rendering contract`);if(!m.openNewestFirst||!m.historyNewestFirst||!m.parlayVisible||!m.historyTabSelected)failures.push(`${result.name}: portfolio presentation`);if(m.status!=='ready')failures.push(`${result.name}: state`);if(Number(result.name.split('x')[0])<=430&&(m.mobileNoiseDisplay!=='none'||m.backdropFilter!=='none'))failures.push(`${result.name}: mobile compositor rules`)}
    console.log(JSON.stringify({runs:results.length,failures,results:results.map(r=>({name:r.name,metrics:r.metrics,errors:r.errors}))},null,2));if(failures.length)process.exitCode=1;
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
