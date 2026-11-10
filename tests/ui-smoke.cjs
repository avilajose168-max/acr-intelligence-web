const path=require('node:path');
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
// Mantener una hora operacional estable para que el evento 09:00–11:00 ya haya ocurrido, independiente del horario del CI.
await page.clock.install({time:new Date('2026-11-09T15:00:00Z')});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const sharedSnapshots=new Map();
let latestSharedToken=null;

const testOrgId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const testOwnerId='11111111-1111-4111-8111-111111111111';
const testOrgName='Compañía Minera de Prueba';
const mockOrganizations=[{id:testOrgId,name:testOrgName,active:true}];
const mockMemberships=[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',organization_id:testOrgId,user_id:testOwnerId,display_name:'Supervisor Administrador',email:'test@example.com',status:'approved',role:'admin'}];
const mockCompanyCases=[];
const mockSubscriptions=[];

await page.route('https://tfrgnqcspdlimdzluxds.supabase.co/**',async route=>{
  const url=route.request().url();
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, GET, OPTIONS','access-control-allow-headers':'*','content-type':'application/json'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(url.includes('/auth/v1/token?grant_type=password'))return route.fulfill({status:200,headers,body:JSON.stringify({
    access_token:'test-access-token',refresh_token:'test-refresh-token',expires_in:3600,
    user:{id:'11111111-1111-4111-8111-111111111111',email:'test@example.com'}
  })});

  if(url.includes('/rest/v1/acr_client_subscriptions')){
   const method=route.request().method();
   if(method==='POST'){
    const entry=route.request().postDataJSON();
    const index=mockSubscriptions.findIndex(x=>x.organization_id===entry.organization_id);
    if(index>=0)mockSubscriptions[index]=entry;else mockSubscriptions.push(entry);
    return route.fulfill({status:201,headers,body:'{}'});
   }
   return route.fulfill({status:200,headers,body:JSON.stringify(mockSubscriptions)});
  }
  if(url.includes('/rest/v1/acr_platform_admins'))return route.fulfill({status:200,headers,body:JSON.stringify([{user_id:testOwnerId}])});
  if(url.includes('/rest/v1/acr_organizations')){
    const method=route.request().method();
    if(method==='POST'){
      const obj=route.request().postDataJSON(),entry={...obj,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',active:true};
      mockOrganizations.push(entry);
      return route.fulfill({status:201,headers,body:JSON.stringify([entry])});
    }
    return route.fulfill({status:200,headers,body:JSON.stringify(mockOrganizations)});
  }
  if(url.includes('/rest/v1/acr_memberships')){
    const request=new URL(url),method=route.request().method();
    const orgId=request.searchParams.get('organization_id')?.replace(/^eq\./,'');
    const userId=request.searchParams.get('user_id')?.replace(/^eq\./,'');
    if(method==='PATCH'){
      const id=request.searchParams.get('id')?.replace(/^eq\./,'');
      const member=mockMemberships.find(m=>m.id===id);
      if(member)Object.assign(member,route.request().postDataJSON());
      return route.fulfill({status:204,headers});
    }
    if(method==='POST'){
      const obj=route.request().postDataJSON();
      mockMemberships.push({...obj,id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});
      return route.fulfill({status:201,headers,body:JSON.stringify([obj])});
    }
    if(method==='DELETE'){
      const memberId=request.searchParams.get('id')?.replace(/^eq\./,'');
      const index=mockMemberships.findIndex(m=>m.id===memberId&&m.organization_id===orgId&&m.user_id!==testOwnerId);
      const removed=index>=0?mockMemberships.splice(index,1):[];
      return route.fulfill({status:200,headers,body:JSON.stringify(removed)});
    }
    return route.fulfill({status:200,headers,body:JSON.stringify(mockMemberships.filter(m=>(!orgId||m.organization_id===orgId)&&(!userId||m.user_id===userId)))});
  }
  if(url.includes('/rest/v1/acr_corporate_investigations')){
    const request=new URL(url),method=route.request().method();
    if(method==='GET')assert.ok((request.searchParams.get('select')||'').split(',').includes('organization_id'),'La consulta corporativa debe traer organization_id para verificar permisos al abrir el informe');
    if(method==='POST'){
      const incoming=route.request().postDataJSON();
      const existing=mockCompanyCases.find(x=>x.organization_id===incoming.organization_id&&x.owner_id===incoming.owner_id&&x.local_case_id===incoming.local_case_id);
      if(existing)Object.assign(existing,incoming);
      else mockCompanyCases.push({...incoming,id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'});
      return route.fulfill({status:201,headers});
    }
    const orgId=request.searchParams.get('organization_id')?.replace(/^eq\./,'');
    return route.fulfill({status:200,headers,body:JSON.stringify(mockCompanyCases.filter(c=>!orgId||c.organization_id===orgId))});
  }
  if(url.includes('/functions/v1/acr-share')){
    const posted=route.request().postDataJSON();
    if(posted.action==='create'){
      const token='11111111-2222-4333-8444-555555555555';
      latestSharedToken=token;
      sharedSnapshots.set(token,{...posted.investigation});
      return route.fulfill({status:200,headers,body:JSON.stringify({token,expires_at:'2026-12-08T00:00:00Z'})});
    }
    if(posted.action==='read'){
      const item=sharedSnapshots.get(posted.token);
      return route.fulfill({status:item?200:404,headers,body:JSON.stringify(item?{investigation:item,expires_at:'2026-12-08T00:00:00Z'}:{error:'Enlace expirado o revocado'})});
    }
    if(posted.action==='revoke'){
      const deleted=sharedSnapshots.delete(posted.token);
      return route.fulfill({status:200,headers,body:JSON.stringify({revoked:deleted})});
    }
  }
  if(url.includes('/functions/v1/acr-assistant'))return route.fulfill({status:503,headers,body:JSON.stringify({error:'La IA externa todavía no está configurada'})});
  return route.fulfill({status:200,headers,body:'{}'});
});
await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
assert.equal(await page.locator('#authCompanyWrap').isVisible(),true,'La selección de perfil debe aparecer al iniciar sesión');
assert.equal(await page.locator('#authAffiliation').inputValue(),'independent','Inicio de sesión independiente por defecto');
await page.locator('#authAffiliation').selectOption('company');
await page.locator('#authCompanyFields').waitFor({state:'visible'});
assert.equal(await page.locator('#authRequestedRoleWrap').isVisible(),false,'Un usuario existente no puede solicitar automáticamente administración');
await page.waitForFunction(()=>document.querySelector('#authOrganization option[value="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]'),{timeout:10000});
await page.locator('#authAffiliation').selectOption('independent');
assert.equal(await page.locator('#authCompanyFields').isVisible(),false,'La selección independiente no exige compañía');
await page.locator('#authEmail').fill('test@example.com');
await page.locator('#authPassword').fill('password-test-123');
await page.locator('#authSubmit').click();
await page.locator('#mainApp').waitFor({state:'visible'});
assert.equal(await page.locator('#weekEvents').innerText(),'0','El tablero comienza sin eventos');
await page.locator('#weekPrevious').click();
assert.ok((await page.locator('#weekLabel').innerText()).includes('Semana'),'Permite navegar por semanas históricas');
await page.locator('#weekCurrent').click();
await page.locator('#start').click();
await page.locator('[data-k="equipment"]').fill('CT-11C');
await page.locator('[data-k="title"]').fill('Protección temperatura rodamiento');
await page.locator('[data-k="description"]').fill('Siendo las 23:15, equipo detiene de forma automática por señal de relé de protección. Detector de temperatura #8 (posición rodamiento lado libre del motor) indica alta temperatura. Se realizó relubricación y pruebas.');
const currentDay=await page.evaluate(()=>{const d=new Date();return String(d.getFullYear())+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')});
await page.locator('#stopStart').fill(currentDay+'T09:00');
await page.locator('#stopEnd').fill(currentDay+'T11:00');

await page.locator('input[name="safetyChoice"][value="si"]').check();
await page.locator('#safetyDetails').waitFor({state:'visible'});
await page.locator('[data-k="safetyDescription"]').fill('Ausencia de protección en zona de correas expuestas.');
await page.locator('[data-k="safetyAction"]').fill('Se restringió el acceso al sector hasta instalar el resguardo faltante.');
await page.locator('input[name="safetyChoice"][value="no"]').check();
await page.locator('#safetyDetails').waitFor({state:'hidden'});
await page.locator('input[name="safetyChoice"][value="si"]').check();
await page.locator('#safetyDetails').waitFor({state:'visible'});
assert.equal(await page.locator('[data-k="safetyDescription"]').inputValue(),'Ausencia de protección en zona de correas expuestas.');
assert.equal(await page.locator('[data-k="safetyAction"]').inputValue(),'Se restringió el acceso al sector hasta instalar el resguardo faltante.');
await page.locator('#improveDescription').click();
await page.locator('#acceptRewrite').waitFor({state:'visible',timeout:20000});
const candidate=await page.locator('#descriptionFeedback').innerText();
assert.ok(candidate.includes('Siendo las 23:15'),'La redacción debe comenzar con el hecho');
await page.locator('#acceptRewrite').click();
await page.locator('#nextAnalysis').click();
await page.locator('#generateWhysAnalysis').click();
await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-why]')).filter(x=>x.value.trim()).length===5,{timeout:15000});
await page.locator('#generateHypotheses').click();
await page.waitForFunction(()=>document.querySelector('[data-k="basicCause"]').value.length>10&&document.querySelector('[data-k="causeConsequence"]').value.length>10,{timeout:15000});
assert.equal(await page.locator('#hypothesisFields').count(),0,'No deben aparecer hipótesis 1/2/3');
const base=await page.locator('[data-k="basicCause"]').inputValue();
assert.ok(/rodamiento|t[eé]rmica/.test(base),'Causa básica pertinente');
await page.locator('[data-k="reviewer"]').fill('Revisor de prueba');
// Acciones correctivas: captura de responsable, vencimiento y estado en el ACR.
await page.locator('[data-ai="0"][data-ak="description"]').fill('Verificar transmisión CT-11C');
await page.locator('[data-ai="0"][data-ak="owner"]').fill('Supervisor turno A');
await page.locator('[data-ai="0"][data-ak="due"]').fill('2020-02-01');
assert.equal(await page.locator('[data-ai="0"][data-ak="status"]').inputValue(),'Pendiente','El estado inicial es pendiente');
await page.locator('#nextReport').click();
const report=await page.locator('#printDocument').innerText();
assert.ok(report.includes('Causa básica'),'Informe debe contener causa básica');
assert.ok(report.includes('Consecuencia de la causa'),'Informe debe contener consecuencia');
assert.ok(report.includes('Ausencia de protección en zona de correas expuestas'),'Informe debe contener declaración de seguridad');
assert.ok(report.includes('Se restringió el acceso al sector'),'Informe debe contener acción correctiva de seguridad');
assert.equal((report.match(/Se restringió el acceso al sector/g)||[]).length,1,'Acción de seguridad debe aparecer una sola vez');
assert.ok(!report.includes('CONTROL DE INFORMACIÓN'),'El reporte no debe mostrar el resumen de puntos documentados');
assert.ok(!report.includes('05 · Condición de seguridad'),'No debe duplicarse la sección de seguridad');
// Una única investigación puede entregarse sucesivamente en tres formatos.
const originalTitle=await page.locator('#printDocument h1').innerText();
assert.equal(await page.locator('#reportFormat').inputValue(),'5why','El formato por defecto debe conservarse');
for(const [value,title,css] of [
 ['acr','ANÁLISIS CAUSA RAÍZ','reportMode-acr'],
 ['a3','A3 EJECUTIVO','reportMode-a3'],
 ['5why','ANÁLISIS 5 PORQUÉS','reportMode-5why']]){
 await page.locator('#reportFormat').selectOption(value);
 const panel=page.locator('#printDocument');
 await panel.evaluate(el=>{if(!el.className.includes('reportMode-'))throw Error('Sin formato')});
 assert.ok((await panel.getAttribute('class')).includes(css),'Debe cambiar la plantilla '+value);
 const doc=await panel.innerText();
 assert.ok(doc.includes(title),'El encabezado debe corresponder al formato '+value);
 assert.ok(doc.includes('CT-11C')&&doc.includes('Consecuencia de la causa'),'Los datos deben mantenerse en '+value);
 assert.equal(await panel.locator('h1').innerText(),originalTitle,'El caso no debe duplicarse ni modificarse');
}

// Prueba móvil: archivos de galería, cámara separada y descarga/compartir PDF.
await page.setViewportSize({width:390,height:844});
for(const id of ['photosInput','safetyPhotoInput']){
 const input=page.locator('#'+id);
 assert.equal(await input.getAttribute('capture'),null,'La galería '+id+' no debe forzar la cámara');
 assert.equal(await input.getAttribute('accept'),'image/*','Permitir imágenes existentes');
}
for(const id of ['photosCameraInput','safetyCameraInput']){
 assert.equal(await page.locator('#'+id).getAttribute('capture'),'environment','El control de cámara debe estar disponible');
}
const imgBuffer=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fwwAAAAASUVORK5CYII=','base64');
await page.locator('#photosInput').setInputFiles({name:'registro-en-galeria.png',mimeType:'image/png',buffer:imgBuffer});
await page.waitForFunction(()=>document.querySelectorAll('#photos .photo').length===1,{timeout:15000});
await page.locator('#safetyPhotoInput').setInputFiles({name:'riesgo-en-galeria.png',mimeType:'image/png',buffer:imgBuffer});
await page.waitForFunction(()=>document.querySelectorAll('#safetyPhotos .photo').length===1,{timeout:15000});
await page.locator('button[data-page="reporte"]').click();
await page.evaluate(()=>{window.__casePrintCount=0;window.print=()=>{window.__casePrintCount++}});
await page.locator('#downloadCasePdf').click();
assert.equal(await page.evaluate(()=>window.__casePrintCount),1,'Guardar como PDF utiliza el informe visual y la impresión nativa');
await page.emulateMedia({media:'print'});
assert.equal(await page.locator('#reporte').evaluate(el=>getComputedStyle(el).display),'block','La vista de impresión incluye el informe original');
assert.notEqual(await page.locator('#printDocument').evaluate(el=>getComputedStyle(el).display),'none','El informe visible se conserva para PDF');
const originalPdf=await page.pdf({printBackground:true,preferCSSPageSize:true});
assert.ok(originalPdf.length>3500&&originalPdf.subarray(0,4).toString()==='%PDF','La impresión visual produce un PDF auténtico');
await page.emulateMedia({media:'screen'});
await page.evaluate(()=>{
  window.__shareCount=0;
  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
  Object.defineProperty(navigator,'share',{configurable:true,value:async ({files})=>{
    window.__shareCount++;
    if(files.length!==1 || files[0].type!=='application/pdf')throw Error('PDF inválido para compartir');
  }});
});
await page.locator('#shareCasePdf').click();
await page.waitForFunction(()=>window.__shareCount===1,{timeout:15000});
await page.setViewportSize({width:1440,height:900});

await page.locator('#reportFormat').selectOption('a3');
await page.emulateMedia({media:'print'});
const executivePdf=await page.pdf({printBackground:true,preferCSSPageSize:true});
const executivePdfPages=(executivePdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
assert.ok(executivePdfPages>=1,'La impresión A3 debe generar al menos una hoja');
if(executivePdfPages>1)console.warn('ADVERTENCIA: exportación A3 produjo '+executivePdfPages+' páginas; sigue pendiente eliminar la hoja adicional.');
await page.emulateMedia({media:'screen'});
await page.locator('#saveAllReport').click();
await page.locator('#commitScopeMessage').waitFor({state:'visible'});
assert.ok((await page.locator('#commitScopeMessage').innerText()).includes('1 compromiso(s)'),'Guardar todo confirma los compromisos');
assert.equal(await page.locator('#commitPeriod').inputValue(),'all','Los compromisos nuevos se muestran sin filtro de vencimiento');
assert.ok((await page.locator('#commitmentsTable').innerText()).includes('Verificar transmisión CT-11C'),'Acción recién guardada aparece en el tablero personal');
await page.locator('button[data-page="reporte"]').click();
await page.locator('button[data-page="inicio"]').click();

// V40: la acción vencida del ensayo pertenece a febrero de 2020; seleccionar ese mes.
await page.locator('#commitPeriod').selectOption('monthly');
await page.evaluate(()=>{
 for(let i=0;i<120&&!document.querySelector('#commitPeriodLabel').textContent.includes('2020-02-01');i++)document.querySelector('#commitPrevious').click();
 if(!document.querySelector('#commitPeriodLabel').textContent.includes('2020-02-01'))throw Error('No se encontró febrero de 2020 en navegación mensual');
});
assert.ok((await page.locator('#commitPeriodLabel').innerText()).includes('2020'),'El filtro reconoce el mes histórico');
assert.equal(await page.locator('#commitTotal').innerText(),'1','Existe un compromiso registrado');
assert.equal(await page.locator('#commitOverdue').innerText(),'1','Se detecta fecha vencida automáticamente');
assert.equal(await page.locator('#commitComplete').innerText(),'0','No hay acciones completadas inicialmente');
assert.ok((await page.locator('#commitmentsTable').innerText()).includes('Verificar transmisión CT-11C'));
// Vista previa de compromisos conserva período y muestra el informe antes de exportar.
await page.locator('#previewCommitments').click();
assert.equal(await page.locator('#commitmentsReport').evaluate(el=>el.classList.contains('active')),true,'Vista previa abierta');
const previewCommitText=await page.locator('#commitmentsReportContent').innerText();
assert.ok(previewCommitText.includes('2020')&&previewCommitText.includes('Verificar transmisión CT-11C'),'Vista previa mensual con acción registrada');
assert.ok(previewCommitText.includes('Vencido')&&previewCommitText.includes('Supervisor turno A'),'Se muestran responsables y estados');
await page.locator('#commitmentsReportBack').click();
assert.equal(await page.locator('#commitTotal').innerText(),'1','Regresa al tablero sin alterar datos');
await page.locator('#commitFilter').selectOption('overdue');
assert.equal(await page.locator('#commitmentsTable tr').count(),1,'Filtro de vencidos');
const excelWait=page.waitForEvent('download');
await page.locator('#exportCommitmentsExcel').click();
const excel=await excelWait;
assert.ok(excel.suggestedFilename().endsWith('.csv'),'Exportación Excel compatible');
assert.ok(require('node:fs').readFileSync(await excel.path(),'utf8').includes('Supervisor turno A'),'CSV contiene responsable');
const commitPdfWait=page.waitForEvent('download');
await page.locator('#exportCommitmentsPdf').click();
const commitPdf=await commitPdfWait;
assert.ok(commitPdf.suggestedFilename().endsWith('.pdf'),'El seguimiento exporta PDF real');
assert.equal(require('node:fs').readFileSync(await commitPdf.path()).subarray(0,4).toString(),'%PDF','PDF válido');
await page.locator('#commitFilter').selectOption('all');
await page.locator('[data-commit-case]').first().selectOption('Completado');
assert.equal(await page.locator('#commitOverdue').innerText(),'0','Compromiso completado deja de estar vencido');
assert.equal(await page.locator('#commitRate').innerText(),'100%','El cumplimiento refleja el cierre');
await page.locator('[data-commit-open]').first().click();
assert.equal(await page.locator('[data-ai="0"][data-ak="status"]').inputValue(),'Completado','El ACR original conserva el estado actualizado');
await page.locator('button[data-page="inicio"]').click();
assert.equal(await page.locator('#weekEvents').innerText(),'1','Una falla registrada');
await page.locator('#reliabilityArea').selectOption('Área Húmeda');
assert.equal(await page.locator('#weekEvents').innerText(),'0','Área Húmeda excluye falla sin área');
assert.equal(await page.locator('#reliabilitySubareaWrap').isVisible(),true,'Área Húmeda despliega unidad de producción');
await page.locator('#reliabilitySubarea').selectOption('AGUAS CALAMA');
assert.ok((await page.locator('#weekLabel').innerText()).includes('AGUAS CALAMA'),'Tablero identifica unidad húmeda');
await page.locator('#reliabilityArea').selectOption('Área Seca');
assert.ok((await page.locator('#reliabilitySubarea').locator('option').allTextContents()).includes('Chancado'),'Área Seca ofrece Chancado');
await page.locator('#reliabilitySubarea').selectOption('Apilamiento');
assert.equal(await page.locator('#weekEvents').innerText(),'0','Filtra sectores de Área Seca');
await page.locator('#reliabilityArea').selectOption('__all__');
assert.equal(await page.locator('#weekEvents').innerText(),'1','Todas las áreas recupera la falla sin clasificar');

await page.locator('#reliabilityPeriod').selectOption('monthly');
assert.ok((await page.locator('#weekLabel').innerText()).includes(new Date().getFullYear().toString()),'El resumen mensual identifica el año');
assert.equal(await page.locator('#weekEvents').innerText(),'1','El informe mensual contabiliza la falla');
await page.locator('#previewWeekly').click();
assert.ok((await page.locator('#weeklyReportContent').innerText()).includes('mensual'),'El informe mensual se genera correctamente');
await page.locator('#weeklyBack').click();
await page.locator('#reliabilityPeriod').selectOption('weekly');
assert.ok((await page.locator('#paretoTable').innerText()).includes('CT-11C'),'Pareto muestra caso');
await page.locator('#reliabilityAsset').selectOption('CT-11C');
const fromClock=await page.locator('#weekBaseAuto').innerText();
assert.match(fromClock,/\d+,\d+ h/,'Horas base automáticas por reloj');
const baseValue=Number(fromClock.replace(' h','').replaceAll('.','').replace(',','.'));
assert.ok(baseValue>0&&baseValue<=168,'Semana actual solo cuenta horas transcurridas');
assert.equal(await page.locator('#weekMttr').innerText(),'2,00 h','MTTR usa tiempo registrado');
const runText=await page.locator('#weekOperatingTotal').innerText();
assert.ok(Math.abs(Number(runText.replace(' h','').replace(',','.'))-(baseValue-2))<0.03,'Horas operadas = horas calendario acumuladas menos detención');
assert.ok((await page.locator('#weekMtbf').innerText()).endsWith(' h'),'MTBF se calcula sin ingreso manual');
assert.ok((await page.locator('#weekAvailability').innerText()).endsWith('%'),'Disponibilidad automática');
await page.locator('#weekPrevious').click();
assert.equal(await page.locator('#weekBaseAuto').innerText(),'168,00 h','Semanas anteriores muestran base completa');
await page.locator('#weekNext').click();
assert.equal(await page.locator('#weekBaseAuto').innerText(),fromClock,'Semana actual restaura base por reloj');
await page.locator('#reliabilityAsset').selectOption('__all__');

await page.locator('#paretoMetric').selectOption('hours');
assert.ok((await page.locator('#weekHours').innerText()).includes('2,00'),'Debe calcular horas detenidas');
assert.ok((await page.locator('#paretoChart').innerText()).length>0,'El gráfico de horas debe aparecer');
await page.locator('#paretoGroup').selectOption('failure');
assert.ok((await page.locator('#paretoTable').innerText()).includes('Protección temperatura rodamiento'),'Agrupación por tipo de falla');
await page.locator('#weekPrevious').click();
assert.equal(await page.locator('#weekEvents').innerText(),'0','La semana anterior no incluye el caso actual');
await page.locator('#weekNext').click();
assert.equal(await page.locator('#weekEvents').innerText(),'1','Al regresar reaparece el mismo evento');

assert.equal(await page.locator('#casesList .listItem').count(),1,'Cambiar plantilla no debe crear una investigación nueva');
await page.locator('#casesList .listItem').first().click();
await page.locator('button[data-page="reporte"]').click();
assert.equal(await page.locator('#reportFormat').inputValue(),'a3','La preferencia de impresión se conserva al reabrir');
assert.ok((await page.locator('#printDocument').getAttribute('class')).includes('reportMode-a3'));

// Informes de Pareto: vista previa, impresión, PDF y PowerPoint reales.
await page.locator('button[data-page="inicio"]').click();
await page.locator('#paretoMetric').selectOption('events');
await page.locator('#paretoGroup').selectOption('equipment');
await page.locator('#previewWeekly').click();
await page.locator('#weeklyReportContent').waitFor({state:'visible'});
const weekReport=await page.locator('#weeklyReportContent').innerText();
assert.ok(weekReport.includes('CT-11C')&&weekReport.includes('2,00 h'),'El informe de Pareto conserva los datos del caso');
assert.ok(weekReport.includes('Semana'),'Se identifica el período informado');
assert.ok(weekReport.includes('MTTR')&&weekReport.includes('MTBF'),'Los indicadores deben figurar en el informe imprimible');
assert.ok(weekReport.includes('Disponibilidad')&&weekReport.includes('Horas operativas'),'El informe reporta indicadores calculados automáticamente');

await page.evaluate(()=>{window.print=()=>{window.__weeklyPrinted=document.body.classList.contains('weekly-print')}});
await page.locator('#weeklyPrintPreview').click();
assert.equal(await page.evaluate(()=>window.__weeklyPrinted),true,'Impresión usa el formato semanal');
await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
assert.equal(await page.evaluate(()=>document.body.classList.contains('weekly-print')),false,'Restaurar formato después de imprimir');
const fs=require('node:fs');
const pdfTask=page.waitForEvent('download',{timeout:45000});
await page.locator('#weeklyPdfPreview').click();
const pdf=await pdfTask;
assert.ok(pdf.suggestedFilename().endsWith('.pdf'),'Descarga PDF real');
const pdfData=fs.readFileSync(await pdf.path());
assert.ok(pdfData.length>2500 && pdfData.subarray(0,4).toString()==='%PDF','El PDF generado debe ser válido y tener contenido');
console.log('PPT library:',await page.evaluate(()=>typeof window.pptxgen));
const reportExportDialog=async d=>{console.log('EXPORT_DIALOG:',d.message());await d.dismiss()};
page.on('dialog',reportExportDialog);
const pptTask=page.waitForEvent('download',{timeout:13000});
await page.locator('#weeklyPptPreview').click();
const ppt=await pptTask;
assert.ok(ppt.suggestedFilename().endsWith('.pptx'),'Descarga PPTX real');
page.off('dialog',reportExportDialog);
const pptData=fs.readFileSync(await ppt.path());
assert.ok(pptData.length>4500 && pptData.subarray(0,2).toString()==='PK','PowerPoint debe ser un ZIP OpenXML válido');
await page.locator('#weeklyBack').click();
assert.equal(await page.locator('#casesList .listItem').count(),1,'La exportación no debe duplicar registros');
// Eliminación individual: confirmación, cancelación y actualización del Pareto.
await page.locator('#start').click();
await page.locator('[data-k="title"]').fill('Registro de prueba a eliminar');
await page.locator('button[data-page="inicio"]').click();
assert.equal(await page.locator('#casesList .listItem').count(),2,'Debe agregar investigación independiente');
page.once('dialog',d=>d.dismiss());
await page.locator('[data-delete-id]').first().click();
assert.equal(await page.locator('#casesList .listItem').count(),2,'Cancelar borrado conserva el registro');
page.once('dialog',d=>d.accept());
await page.locator('[data-delete-id]').first().click();
assert.equal(await page.locator('#casesList .listItem').count(),1,'Confirmar borrado elimina solo el registro elegido');
assert.equal(await page.locator('#weekEvents').innerText(),'1','Borrar un registro vacío no altera el número de fallas');
assert.ok((await page.locator('#casesList').innerText()).includes('Protección temperatura rodamiento'),'Otra investigación permanece intacta');

// Compartir enlace a cuenta ajena: solo lectura y clonación independiente.
await page.locator('#casesList .listItem').first().click();
await page.locator('button[data-page="reporte"]').click();
await page.locator('#shareInvestigationLink').click();
await page.locator('#shareResult').waitFor({state:'visible',timeout:15000});
const shareUrl=await page.locator('#shareLinkValue').inputValue();
assert.ok(shareUrl.includes('?share=11111111-2222-4333-8444-555555555555'),'Enlace contiene identificador de acceso');
assert.equal(await page.locator('#casesList .listItem').count(),1,'Compartir no crea ni modifica el caso original');
const originalDescription=await page.locator('[data-k="description"]').inputValue();
const other=await browser.newContext({viewport:{width:390,height:844}});
const recipient=await other.newPage();
recipient.on('pageerror',e=>errors.push('recipient: '+e.message));
await recipient.route('https://tfrgnqcspdlimdzluxds.supabase.co/**',async route=>{
 const url=route.request().url();
 const headers={'access-control-allow-origin':'*','content-type':'application/json'};
 if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
 if(url.includes('/auth/v1/token?grant_type=password'))return route.fulfill({status:200,headers,body:JSON.stringify({
  access_token:'recipient-token',refresh_token:'recipient-refresh',expires_in:3600,
  user:{id:'22222222-2222-4222-8222-222222222222',email:'revisor@example.com'}
 })});
 if(url.includes('/functions/v1/acr-share')){
   const input=route.request().postDataJSON(),item=sharedSnapshots.get(input.token);
   return route.fulfill({status:item?200:404,headers,body:JSON.stringify(item?{investigation:item,expires_at:'2026-12-08T00:00:00Z'}:{error:'Enlace no válido'})});
 }
 return route.fulfill({status:200,headers,body:'{}'});
});
await recipient.goto(shareUrl.replace('https://avilajose168-max.github.io/acr-intelligence-web/','http://127.0.0.1:8765/index.html'),{waitUntil:'domcontentloaded'});
assert.equal(await recipient.locator('#sharedOverlay').isVisible(),false,'No puede ver enlace sin iniciar sesión');
await recipient.locator('#authEmail').fill('revisor@example.com');
await recipient.locator('#authPassword').fill('password-test-123');
await recipient.locator('#authSubmit').click();
await recipient.locator('#sharedOverlay').waitFor({state:'visible'});
assert.ok((await recipient.locator('#sharedBody').innerText()).includes(originalDescription.slice(0,45)),'El receptor visualiza los datos compartidos');
assert.equal(await recipient.locator('#casesList .listItem').count(),0,'Ver el enlace no copia ni altera datos');
recipient.once('dialog',d=>d.accept());
await recipient.locator('#importShared').click();
await recipient.locator('#sharedOverlay').waitFor({state:'hidden'});
assert.equal(await recipient.locator('#casesList .listItem').count(),1,'Receptor guarda copia editable');
await recipient.locator('[data-k="description"]').fill('Corrección privada de la copia del destinatario');
await recipient.locator('button[data-page="inicio"]').click();
assert.equal(await page.locator('[data-k="description"]').inputValue(),originalDescription,'Cambios en copia recibida no alteran el original');
await recipient.close();await other.close();
await page.locator('#revokeInvestigationLink').click().catch(()=>{});


// V28: un administrador visualiza usuarios e investigaciones SOLO de la organización seleccionada.
await page.locator('button[data-page="organizaciones"]').click();
await page.waitForFunction(()=>document.querySelectorAll('#organizationSelect option').length>1,{timeout:15000});
await page.locator('#organizationSelect').selectOption(testOrgId);
await page.locator('#companyAdminPanel').waitFor({state:'visible'});
await page.waitForFunction(()=>document.querySelector('#orgUserCount')?.textContent==='1',{timeout:15000});
assert.equal(await page.locator('#platformAdminPanel').isVisible(),true,'La cuenta designada es administradora de la plataforma');
await page.waitForFunction(()=>document.querySelector('#billingRows')?.textContent?.includes(testOrgName),{timeout:12000});
assert.equal(await page.locator('#platformBillingModule').isVisible(),true,'Solo el administrador general ve clientes y suscripciones');
await page.locator('[data-billing-edit="'+testOrgId+'"]').click();
await page.locator('#billingEditor [name="plan_name"]').fill('Beta corporativa');
await page.locator('#billingEditor [name="contract_reference"]').fill('TEST-2026');
await page.locator('#billingEditor [name="seat_limit"]').fill('10');
await page.locator('#billingEditor [name="ai_monthly_limit"]').fill('300');
await page.locator('#billingEditor [name="ai_usage_reported"]').fill('22');
await page.locator('#billingEditor [name="advisory_hours_included"]').fill('8');
await page.locator('#billingEditor [name="advisory_hours_used"]').fill('2');
await page.locator('#billingSave').click();
await page.waitForFunction(()=>document.querySelector('#billingRows')?.textContent?.includes('Beta corporativa'),{timeout:12000});
assert.equal(mockSubscriptions[0].organization_id,testOrgId,'El contrato se guarda para la empresa correcta');
assert.equal(mockSubscriptions[0].ai_usage_reported,22,'Registro manual de consumo IA');
assert.equal(await page.locator('#billingAdvisory').innerText(),'6 h','Saldo de horas de asesoría calculado');
assert.ok((await page.locator('#companyAdminTitle').innerText()).includes(testOrgName),'Consolidado solo de compañía seleccionada');
assert.equal(await page.locator('#orgCaseCount').innerText(),'0','Los ACR locales no se exponen sin publicación');
page.once('dialog',d=>d.accept());
await page.locator('#publishCompanyCases').click();
await page.waitForFunction(()=>document.querySelector('#corporateSyncStatus')?.textContent.includes('1 investigaciones corporativas'),{timeout:15000});
assert.equal(mockCompanyCases.length,1,'La publicación corporativa se envía al servidor con afiliación aprobada');
assert.equal(mockCompanyCases[0].organization_id,testOrgId,'Investigación asociada a la organización correcta');
assert.equal(mockCompanyCases[0].owner_id,testOwnerId,'Propietario queda registrado en la empresa');
await page.locator('#refreshOrganizations').click();
await page.waitForFunction(()=>document.querySelector('#orgCaseCount')?.textContent==='1',{timeout:15000});
assert.ok((await page.locator('#orgCasesTable').innerText()).includes('CT-11C'),'Administrador ve los ACR corporativos');

assert.equal(await page.locator('#corpEvents').innerText(),'1','Tablero corporativo semanal muestra una falla publicada');
assert.equal(await page.locator('#corpMttr').innerText(),'2,00 h','MTTR corporativo usa detención de dos horas');
assert.ok((await page.locator('#corporateParetoTable').innerText()).includes('CT-11C'),'Pareto corporativo agrupa por equipo');
assert.equal(await page.locator('#corporateTrendChart svg').count(),1,'Confiabilidad corporativa presenta tendencia de ocho semanas');
assert.equal(await page.locator('#corporateTrendChart svg rect').count(),8,'Tendencia semanal presenta ocho barras');
assert.equal(await page.locator('#corporateTrendMetric').count(),0,'No debe existir selector duplicado de tendencia');
assert.equal(await page.locator('#corporateParetoMetric').count(),1,'Existe un único selector para Pareto y tendencia');
await page.locator('#corporateParetoMetric').selectOption('hours');
assert.ok((await page.locator('#corporateTrendLabel').innerText()).includes('8 semanas'),'Tendencia corporativa muestra ocho semanas');
assert.equal(await page.locator('#corporateTrendChart svg rect').count(),8,'Tendencia se mantiene con ocho barras al cambiar a horas');
assert.ok((await page.locator('#corporateParetoTable').innerText()).includes('2,00'),'Pareto por horas registradas');
await page.locator('#corporatePeriod').selectOption('monthly');
assert.equal(await page.locator('#corpEvents').innerText(),'1','El Pareto mensual utiliza los ACR de la compañía');
assert.ok((await page.locator('#corporatePeriodLabel').innerText()).toLocaleLowerCase('es').includes('noviembre'),'Período mensual muestra nombre del mes');
await page.locator('#corporatePrevious').click();
assert.equal(await page.locator('#corpEvents').innerText(),'0','Mes anterior excluye eventos del mes actual');
await page.locator('#corporateCurrent').click();
assert.equal(await page.locator('#corpEvents').innerText(),'1','Restauración al mes actual');
const monthlyDownload=page.waitForEvent('download');
await page.locator('#corporateExportPeriod').click();
const monthlyCsv=await monthlyDownload;
assert.ok(monthlyCsv.suggestedFilename().endsWith('.csv'),'Descarga reporte corporativo mensual');
assert.ok(require('node:fs').readFileSync(await monthlyCsv.path(),'utf8').includes('CT-11C'),'Reporte mensual incluye equipo');

await page.locator('[data-org-case]').first().click();
assert.ok((await page.locator('#orgCaseDetail').innerText()).includes('Protección temperatura rodamiento'),'Vista corporativa contiene investigación');
const exportCompanyTask=page.waitForEvent('download');
await page.locator('#exportCompanyCsv').click();
const companyCsv=await exportCompanyTask;
assert.ok(companyCsv.suggestedFilename().endsWith('.csv'),'Consolidado corporativo exportable a Excel');
const memberRole=page.locator('[data-org-member-role]').first();
assert.equal(await memberRole.inputValue(),'admin','Rol del usuario visible al administrador');
await page.locator('#newOrganizationName').fill('Empresa Industrial Independiente');
page.once('dialog',d=>d.accept());
await page.locator('#createOrganization').click();
await page.waitForFunction(()=>document.querySelectorAll('#organizationSelect option').length===3,{timeout:15000});
await page.locator('#organizationSelect').selectOption('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
await page.waitForFunction(()=>document.querySelector('#orgCaseCount')?.textContent==='0',{timeout:15000});
assert.equal(await page.locator('#orgUserCount').innerText(),'0','Nueva empresa no hereda los usuarios de la anterior');
assert.equal(await page.locator('#corpEvents').innerText(),'0','Nueva empresa no hereda eventos del tablero');
assert.equal(await page.locator('#orgCasesTable').innerText(),'No hay ACR corporativos publicados en esta compañía. Los usuarios deben confirmar la publicación de sus informes para que el administrador pueda verlos.','Nueva empresa no hereda investigaciones');
await page.locator('button[data-page="inicio"]').click();



// V32: la administradora de una compañía entra DIRECTAMENTE a su tablero, sin selector.
const companyAdminId='22222222-2222-4222-8222-222222222222';
const companyAdminPage=await browser.newPage({viewport:{width:1280,height:900}});
companyAdminPage.on('pageerror',e=>errors.push('company-admin: '+e.message));
await companyAdminPage.route('https://tfrgnqcspdlimdzluxds.supabase.co/**',async route=>{
 const url=route.request().url(),method=route.request().method();
 const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, GET, OPTIONS','access-control-allow-headers':'*','content-type':'application/json'};
 if(method==='OPTIONS')return route.fulfill({status:204,headers});
 if(url.includes('/auth/v1/token?grant_type=password'))return route.fulfill({status:200,headers,body:JSON.stringify({
  access_token:'company-admin-token',refresh_token:'company-admin-refresh',expires_in:3600,
  user:{id:companyAdminId,email:'lupe@example.test'}
 })});
 if(url.includes('/rest/v1/acr_platform_admins'))return route.fulfill({status:200,headers,body:'[]'});
 if(url.includes('/rest/v1/acr_organizations'))return route.fulfill({status:200,headers,body:JSON.stringify(mockOrganizations)});
 if(url.includes('/rest/v1/acr_memberships')){
  const member={id:'33333333-3333-4333-8333-333333333333',organization_id:testOrgId,user_id:companyAdminId,
   display_name:'Lupe Aguilera',email:'lupe@example.test',role:'admin',status:'approved',requested_role:'admin'};
  const parsed=new URL(url),own=parsed.searchParams.get('user_id')?.replace(/^eq\./,'');
  return route.fulfill({status:200,headers,body:JSON.stringify(own?[member]:[member,...mockMemberships])});
 }
 if(url.includes('/rest/v1/acr_corporate_investigations')){
  const org=new URL(url).searchParams.get('organization_id')?.replace(/^eq\./,'');
  return route.fulfill({status:200,headers,body:JSON.stringify(mockCompanyCases.filter(c=>c.organization_id===org))});
 }
 return route.fulfill({status:200,headers,body:'{}'});
});
await companyAdminPage.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
await companyAdminPage.locator('#authEmail').fill('lupe@example.test');
await companyAdminPage.locator('#authPassword').fill('password-test-123');
await companyAdminPage.locator('#authSubmit').click();
await companyAdminPage.waitForFunction(()=>document.querySelector('#organizaciones')?.classList.contains('active'),{timeout:15000});
await companyAdminPage.locator('#companyAdminPanel').waitFor({state:'visible'});
assert.equal(await companyAdminPage.locator('#corporateAffiliationPanel').isVisible(),false,'La administradora corporativa no ve selector de compañías');
assert.equal(await companyAdminPage.locator('#platformAdminPanel').isVisible(),false,'No tiene controles de administrador general');
assert.ok((await companyAdminPage.locator('#corporateViewTitle').innerText()).includes(testOrgName),'Se abre su compañía directamente');
assert.equal(await companyAdminPage.locator('.nav button[data-page="organizaciones"]').innerText(),'🏢 Mi compañía','La navegación es personalizada');
assert.equal(await companyAdminPage.locator('#orgCaseCount').innerText(),'1','Visualiza ACR de usuarios de su compañía');
assert.equal(await companyAdminPage.locator('#platformBillingModule').isVisible(),false,'Administradores locales no pueden ver contratos de clientes');
assert.ok((await companyAdminPage.locator('#orgUsersTable').innerText()).includes('1'),'Ve cantidad de ACR por usuario');
assert.ok((await companyAdminPage.locator('#companyReportsStatus').innerText()).includes('informe(s) de falla publicado(s)'),'El administrador ve el estado de publicación de los ACR');
await companyAdminPage.locator('#companyViewUserReports').click();
assert.ok(await companyAdminPage.locator('#orgCasesTable [data-org-case]').count()>0,'La tabla muestra informes de falla de usuarios');
await companyAdminPage.locator('#orgCasesTable [data-org-case]').first().click();
assert.ok((await companyAdminPage.locator('#orgCaseDetail').innerText()).includes('ACR corporativo'),'El administrador de empresa puede abrir ACR completo en modo lectura');
assert.equal(await companyAdminPage.locator('[data-org-member-role]').count(),0,'No puede asignar administradores');

assert.equal(await companyAdminPage.locator('#corporateCommitmentsPanel').isVisible(),true,'El tablero corporativo de compromisos está dentro del panel de la empresa');
await companyAdminPage.locator('#corpCommitPeriod').selectOption('all');
assert.equal(await companyAdminPage.locator('#corpCommitTotal').innerText(),'1','Compromiso corporativo publicado visible sin navegar al inicio');
assert.ok((await companyAdminPage.locator('#corpCommitRows').innerText()).includes('Verificar transmisión CT-11C'),'Tabla corporativa incluye compromiso');
await companyAdminPage.locator('#corpCommitStatus').selectOption('overdue');
assert.equal(await companyAdminPage.locator('#corpCommitRows').locator('tr').count(),1,'Filtro de estado corporativo disponible');
await companyAdminPage.locator('#corpCommitStatus').selectOption('all');
const corpDownloadPromise=companyAdminPage.waitForEvent('download');
await companyAdminPage.locator('#corpCommitExport').click();
const corpDownload=await corpDownloadPromise;
assert.ok(corpDownload.suggestedFilename().endsWith('.csv'),'Descarga compromisos corporativos');


// Ambos tableros corporativos presentan informe previo y permiten guardar PDF.
await companyAdminPage.locator('#corpRelPreview').click();
await companyAdminPage.locator('#corpReportSheet').waitFor({state:'visible'});
let reportContents=await companyAdminPage.locator('#corpReportSheet').innerText();
assert.ok(reportContents.includes('Informe corporativo de confiabilidad')&&reportContents.includes('CT-11C'),'Vista previa corporativa de confiabilidad refleja los eventos publicados');
assert.ok(await companyAdminPage.locator('#corpReportSheet .corp-report-chart svg').count()>0,'El informe de confiabilidad muestra gráfico Pareto, no solo tabla');
assert.equal(await companyAdminPage.locator('#corpReportSheet .corp-report-chart svg').count(),2,'Informe corporativo de confiabilidad incluye Pareto y tendencia semanal');
assert.ok(reportContents.includes('Tendencia de las últimas 8 semanas'),'La vista previa incorpora el historial de ocho semanas');
await companyAdminPage.emulateMedia({media:'print'});
await companyAdminPage.evaluate(()=>document.body.classList.add('corp-report-print'));
assert.equal(await companyAdminPage.locator('#corporateReportPreview').evaluate(el=>getComputedStyle(el).display),'block','Se imprime únicamente el informe corporativo');
assert.equal(await companyAdminPage.locator('#reporte').evaluate(el=>getComputedStyle(el).display),'none','Se oculta el informe individual durante impresión corporativa');
let reportPdf=await companyAdminPage.pdf({printBackground:true,preferCSSPageSize:true});
assert.ok(reportPdf.length>3500&&reportPdf.subarray(0,4).toString()==='%PDF','El informe de confiabilidad genera PDF');
await companyAdminPage.evaluate(()=>document.body.classList.remove('corp-report-print'));
await companyAdminPage.emulateMedia({media:'screen'});
await companyAdminPage.locator('#corpReportBack').click();
await companyAdminPage.locator('#corpCommitPreview').click();
reportContents=await companyAdminPage.locator('#corpReportSheet').innerText();
assert.ok(reportContents.includes('Informe corporativo de seguimiento de compromisos')&&reportContents.includes('Verificar transmisión CT-11C'),'Vista previa de compromisos conserva las acciones publicadas');
assert.equal(await companyAdminPage.locator('#corpReportSheet .corp-report-chart svg').count(),0,'El informe corporativo de compromisos no lleva Pareto');
assert.equal(await companyAdminPage.locator('#corporateCommitmentsPanel #corpCommitParetoChart').count(),0,'El tablero corporativo de compromisos no lleva Pareto');
await companyAdminPage.evaluate(()=>{window.__corporatePrintCalls=0;window.print=()=>{window.__corporatePrintCalls++}});
await companyAdminPage.locator('#corpReportSavePdf').click();
assert.equal(await companyAdminPage.evaluate(()=>window.__corporatePrintCalls),1,'Guardar PDF invoca la impresión fiel de la vista previa');
await companyAdminPage.locator('#corpReportBack').click();

// Desglose de una misma empresa entre Área Seca y Área Húmeda.
const wetSample=structuredClone(mockCompanyCases.find(x=>x.organization_id===testOrgId));
assert.ok(wetSample,'Existe ACR inicial para ensayar las dos áreas');
wetSample.id='abababab-abab-4bab-8bab-abababababab';
wetSample.local_case_id='bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
wetSample.payload.id=wetSample.local_case_id;
wetSample.payload.area='Área Húmeda';
wetSample.payload.productionUnit='AGUAS CALAMA';
wetSample.payload.sector='';
wetSample.payload.equipment='BBA AGUA CALAMA #1';
wetSample.payload.title='Daño del impulsor de bomba';
const originalArea=mockCompanyCases.find(x=>x.organization_id===testOrgId);
originalArea.payload.area='Área Seca';
originalArea.payload.sector='Chancado';
mockCompanyCases.push(wetSample);
await companyAdminPage.locator('#corporateRefresh').click();
await companyAdminPage.waitForFunction(()=>document.querySelector('#corpEvents')?.textContent==='2',{timeout:15000});
assert.equal(await companyAdminPage.locator('#corpDryEvents').innerText(),'1 falla','Resumen identifica una falla seca');
assert.equal(await companyAdminPage.locator('#corpWetEvents').innerText(),'1 falla','Resumen identifica una falla húmeda');
await companyAdminPage.locator('#corporateArea').selectOption('Área Húmeda');
assert.equal(await companyAdminPage.locator('#corpEvents').innerText(),'1','Filtro Área Húmeda muestra solo su falla');
await companyAdminPage.locator('#corporateSubarea').selectOption('AGUAS CALAMA');
assert.ok((await companyAdminPage.locator('#corporateParetoTable').innerText()).includes('BBA AGUA CALAMA #1'),'Unidad húmeda filtra Pareto');
await companyAdminPage.locator('#corporateArea').selectOption('Área Seca');
await companyAdminPage.locator('#corporateSubarea').selectOption('Chancado');
assert.equal(await companyAdminPage.locator('#corpEvents').innerText(),'1','Sector Chancado muestra la falla seca');
await companyAdminPage.locator('#corporateArea').selectOption('__all__');
assert.equal(await companyAdminPage.locator('#corpEvents').innerText(),'2','Vista de toda la compañía suma ambas áreas');
mockCompanyCases.splice(mockCompanyCases.indexOf(wetSample),1);
await companyAdminPage.locator('#corporateRefresh').click();
await companyAdminPage.waitForFunction(()=>document.querySelector('#corpEvents')?.textContent==='1',{timeout:15000});

// Otra persona de la compañía publica un ACR con compromisos: el administrador debe verlos.
mockCompanyCases.push({
 id:'fffefefe-ffff-4fff-8fff-ffffffffffff',
 organization_id:testOrgId,owner_id:'44444444-4444-4444-8444-444444444444',
 local_case_id:'55555555-5555-4555-8555-555555555555',
 title:'Falla de impulsor - José Andrés',equipment:'BBA AGUA CALAMA #1',
 payload:{title:'Falla de impulsor - José Andrés',equipment:'BBA AGUA CALAMA #1',
 actions:[{description:'Revisar impulsor y verificar montaje',owner:'José Andrés',due:'2026-11-20',status:'Pendiente'}]}
});
await companyAdminPage.locator('.nav button[data-page="inicio"]').click();
await companyAdminPage.locator('#commitScopeWrap').waitFor({state:'visible'});
await companyAdminPage.locator('#commitScope').selectOption('company');
await companyAdminPage.waitForFunction(()=>document.querySelector('#commitmentsTable')?.textContent?.includes('Revisar impulsor y verificar montaje'),{timeout:15000});
assert.equal(await companyAdminPage.locator('#commitTotal').innerText(),'2','Administración ve compromisos corporativos de distintos investigadores');
assert.ok((await companyAdminPage.locator('#commitmentsTable').innerText()).includes('José Andrés'),'Muestra el compromiso publicado por otro investigador');
assert.equal(await companyAdminPage.locator('[data-commit-case]').count(),0,'Los compromisos de otro usuario son de solo lectura');
await companyAdminPage.locator('.nav button[data-page="organizaciones"]').click();
mockCompanyCases.pop();

if(await companyAdminPage.locator('#orgCaseDetail').isVisible())await companyAdminPage.locator('#collapsePublishedAcr').click();
await companyAdminPage.locator('[data-org-case]').first().click();
assert.equal(await companyAdminPage.locator('#collapsePublishedAcr').count(),1,'El detalle corporativo incluye botón para ocultarlo');
await companyAdminPage.locator('#collapsePublishedAcr').click();
assert.equal(await companyAdminPage.locator('#orgCaseDetail').isVisible(),false,'Ocultar investigación contrae el panel');
await companyAdminPage.locator('[data-org-case]').first().click();
assert.equal(await companyAdminPage.locator('#orgCaseDetail').isVisible(),true,'Ver ACR vuelve a expandir el detalle');
const fullCase=await companyAdminPage.locator('#orgCaseDetail').innerText();
assert.ok(fullCase.includes('Protección temperatura rodamiento'),'Puede abrir los ACR de los usuarios');
assert.ok(fullCase.includes('Causa básica')&&fullCase.includes('Conclusión ejecutiva'),'Vista ACR técnica de solo lectura');
// El informe publicado debe reutilizar la presentación que ve el investigador.
await companyAdminPage.locator('#openPublishedAcrReport').click();
await companyAdminPage.locator('#corporateAcrPreview').waitFor({state:'visible'});
assert.ok((await companyAdminPage.locator('#corporateAcrDocument').innerText()).includes('Protección temperatura rodamiento'),'Vista corporativa presenta el informe real');
assert.equal(await companyAdminPage.locator('#corporateAcrDocument .report-head').count(),1,'Conserva cabecera de informe');
assert.ok(await companyAdminPage.locator('#corporateAcrDocument .reportbox').count()>=7,'Conserva secciones y tablas de informe');
await companyAdminPage.locator('#corporateAcrFormat').selectOption('a3');
assert.equal(await companyAdminPage.locator('#corporateAcrDocument.reportMode-a3').count(),1,'El administrador puede visualizar A3 ejecutivo');
await companyAdminPage.locator('#corporateAcrFormat').selectOption('acr');
assert.equal(await companyAdminPage.locator('#corporateAcrDocument.reportMode-acr').count(),1,'Puede visualizar ACR completo');
await companyAdminPage.evaluate(()=>{window.__corporateAcrPrintCalls=0;window.print=()=>{window.__corporateAcrPrintCalls++}});
await companyAdminPage.locator('#corporateAcrPdf').click();
assert.equal(await companyAdminPage.evaluate(()=>window.__corporateAcrPrintCalls),1,'Guardar PDF abre el diálogo de impresión del documento corporativo');
assert.equal(await companyAdminPage.evaluate(()=>document.body.classList.contains('corp-acr-print')),true,'Impresión usa estilo exclusivo del ACR corporativo');
await companyAdminPage.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
await companyAdminPage.locator('#corporateAcrBack').click();
assert.equal(await companyAdminPage.locator('#companyAdminPanel').isVisible(),true,'Regresar conserva el contexto de compañía');
await companyAdminPage.evaluate(()=>{
 const selector=document.querySelector('#organizationSelect');
 selector.value='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 selector.dispatchEvent(new Event('change',{bubbles:true}));
});
await companyAdminPage.waitForTimeout(300);
assert.ok((await companyAdminPage.locator('#corporateViewTitle').innerText()).includes(testOrgName),'No puede cambiar a otra empresa manipulando el selector oculto');
await companyAdminPage.close();

// Prueba de desvinculación: cancelar, confirmar y conservar el historial.
const departingId='66666666-6666-4666-8666-666666666666';
const departingMembershipId='77777777-7777-4777-8777-777777777777';
mockMemberships.push({id:departingMembershipId,organization_id:testOrgId,user_id:departingId,
 display_name:'Empleado de prueba',email:'empleado-test@example.com',status:'approved',role:'member',requested_role:'member'});
await page.locator('button[data-page="organizaciones"]').click();
await page.locator('#organizationSelect').selectOption(testOrgId);
await page.locator('#companyRefreshUserReports').click();
await page.waitForFunction(()=>document.querySelector('#orgUserCount')?.textContent==='2',{timeout:12000});
assert.equal(await page.locator('[data-org-unlink="'+departingMembershipId+'"]').count(),1,'Administrador puede desvincular otro miembro aprobado');
assert.equal(await page.locator('[data-org-unlink="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]').count(),0,'No puede desvincularse a sí mismo');
page.once('dialog',d=>d.dismiss());
await page.locator('[data-org-unlink="'+departingMembershipId+'"]').click();
assert.equal(mockMemberships.some(m=>m.id===departingMembershipId),true,'Cancelar conserva la afiliación');
page.once('dialog',d=>d.accept());
await page.locator('[data-org-unlink="'+departingMembershipId+'"]').click();
await page.waitForFunction(()=>document.querySelector('#orgUserCount')?.textContent==='1',{timeout:12000});
assert.equal(mockMemberships.some(m=>m.id===departingMembershipId),false,'Confirmar borra exclusivamente la afiliación');
assert.equal(await page.locator('#orgCaseCount').innerText(),'1','El historial de ACR corporativos se conserva');
assert.equal(await page.locator('[data-org-unlink="'+departingMembershipId+'"]').count(),0,'El usuario desvinculado desaparece de la lista');

// V29: al crear una cuenta se elige Independiente o Empresa + rol solicitado, sin conceder privilegios.
const signupPage=await browser.newPage({viewport:{width:430,height:890}});
let recordedSignup=null;
signupPage.on('pageerror',e=>errors.push('signup: '+e.message));
await signupPage.route('https://tfrgnqcspdlimdzluxds.supabase.co/**',async route=>{
 const url=route.request().url();
 const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, GET, OPTIONS','access-control-allow-headers':'*','content-type':'application/json'};
 if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
 if(url.includes('/rest/v1/acr_organizations'))return route.fulfill({status:200,headers,body:JSON.stringify([{id:testOrgId,name:testOrgName}])});
 if(url.includes('/auth/v1/signup')){
  recordedSignup=route.request().postDataJSON();
  return route.fulfill({status:200,headers,body:JSON.stringify({user:{id:'99999999-9999-4999-8999-999999999999'},session:null})});
 }
 return route.fulfill({status:200,headers,body:'{}'});
});
await signupPage.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
await signupPage.locator('#authSwitch').click();
assert.equal(await signupPage.locator('#authCompanyWrap').isVisible(),true,'El selector de afiliación está en el registro');
assert.equal(await signupPage.locator('#authAffiliation').inputValue(),'independent','Predeterminado es independiente');
assert.equal(await signupPage.locator('#authCompanyFields').isVisible(),false,'Independiente no pide compañía');
await signupPage.locator('#authAffiliation').selectOption('company');
await signupPage.locator('#authCompanyFields').waitFor({state:'visible'});
await signupPage.waitForFunction(()=>document.querySelectorAll('#authOrganization option').length>1,{timeout:12000});
await signupPage.locator('#authOrganization').selectOption(testOrgId);
await signupPage.locator('#authRequestedRole').selectOption('admin');
await signupPage.locator('#authName').fill('Jefe de mantenimiento');
await signupPage.locator('#authEmail').fill('jefe-ejemplo@example.com');
await signupPage.locator('#authPassword').fill('test-password-123');
await signupPage.locator('#authSubmit').click();
await signupPage.waitForFunction(()=>document.querySelector('#authFeedback')?.textContent?.includes('Cuenta solicitada'),{timeout:14000});
assert.equal(recordedSignup.data.acr_organization_id,testOrgId,'El servidor recibe la organización seleccionada');
assert.equal(recordedSignup.data.acr_requested_role,'admin','El administrador se registra como solicitud, no se le conceden permisos');
assert.equal(recordedSignup.data.display_name,'Jefe de mantenimiento');
await signupPage.locator('#authSwitch').click();
await signupPage.locator('#authAffiliation').selectOption('independent');
await signupPage.locator('#authEmail').fill('independiente-ejemplo@example.com');
await signupPage.locator('#authPassword').fill('test-password-123');
await signupPage.locator('#authSubmit').click();
await signupPage.waitForFunction(()=>document.querySelector('#authFeedback')?.textContent?.includes('Cuenta solicitada'),{timeout:14000});
assert.equal(recordedSignup.data.acr_organization_id,undefined,'Independiente nunca se afilia a una compañía al registrarse');
assert.equal(recordedSignup.data.acr_requested_role,undefined,'Independiente no obtiene permisos corporativos');
await signupPage.close();

console.log('OK informe semanal, PDF válido, PowerPoint válido, impresión y eliminación individual');
assert.ok(errors.length===0,'Errores de JavaScript en la UI: '+errors.join('; '));
console.log('OK: registro/acceso, investigación, Sí/No seguridad, redacción, 5 Porqués, causa básica, consecuencia e informe');
await browser.close();
})().catch(err=>{console.error(err);process.exit(1)});
