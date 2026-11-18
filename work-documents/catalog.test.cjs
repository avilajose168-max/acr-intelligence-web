const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2]||'index.html','utf8');
const definitions=['CHANCADO_ASSETS','APILAMIENTO_ASSETS','AREA_HUMEDA_ASSETS'].map(name=>{const value=source.match(new RegExp('^const '+name+'=.*;$','m'));assert(value,'Missing '+name);return value[0];}).join('\n');
const start=source.indexOf('catalog:orgId=>'),end=source.indexOf(',request:async',start);assert(start>=0&&end>start);const callback=source.slice(start+'catalog:'.length,end);
const corporateCtx={organizations:[{id:'lomas',name:'Compañía Minera Lomas Bayas'},{id:'spaces',name:'LOMAS  BAYAS'},{id:'other',name:'Otra compañía'}]};
const catalog=vm.runInNewContext(definitions+'\n('+callback+')',{corporateCtx});
const rows=catalog('lomas');assert(rows.length>50,'The real company catalog must load before documents exist');assert.equal(catalog('spaces').length,rows.length);assert.equal(catalog('other').length,0);
assert(rows.some(r=>r.area==='Área Seca'&&r.sector==='Chancado'));assert(rows.some(r=>r.area==='Área Seca'&&r.sector==='Apilamiento'));assert(rows.some(r=>r.area==='Área Húmeda'&&r.sector==='AGUAS CALAMA'&&r.name==='BBA AGUA CALAMA #1'&&r.sap==='51 PMP001'));
console.log('PASS actual application catalog: '+rows.length+' equipment entries, dry/wet sectors, SAP mapping, company-name recognition and company separation');
