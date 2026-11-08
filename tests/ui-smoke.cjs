const path=require('node:path');
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const sharedSnapshots=new Map();
let latestSharedToken=null;

await page.route('https://tfrgnqcspdlimdzluxds.supabase.co/**',async route=>{
  const url=route.request().url();
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, GET, OPTIONS','access-control-allow-headers':'*','content-type':'application/json'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(url.includes('/auth/v1/token?grant_type=password'))return route.fulfill({status:200,headers,body:JSON.stringify({
    access_token:'test-access-token',refresh_token:'test-refresh-token',expires_in:3600,
    user:{id:'11111111-1111-4111-8111-111111111111',email:'test@example.com'}
  })});
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
const individualPdfTask=page.waitForEvent('download',{timeout:30000});
await page.locator('#downloadCasePdf').click();
const individualPdf=await individualPdfTask;
assert.ok(individualPdf.suggestedFilename().endsWith('.pdf'),'El informe individual debe descargarse en teléfono');
const pdfBytes=require('node:fs').readFileSync(await individualPdf.path());
assert.ok(pdfBytes.length>3500&&pdfBytes.subarray(0,4).toString()==='%PDF','El PDF debe contener las secciones y fotos');
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
await page.locator('button[data-page="inicio"]').click();
assert.equal(await page.locator('#weekEvents').innerText(),'1','Debe incluir el evento recién guardado');
assert.equal(await page.locator('#weekAssets').innerText(),'1','Debe reconocer un equipo afectado');
assert.ok((await page.locator('#paretoTable').innerText()).includes('CT-11C'),'Pareto por equipo muestra el caso');
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

console.log('OK informe semanal, PDF válido, PowerPoint válido, impresión y eliminación individual');
assert.ok(errors.length===0,'Errores de JavaScript en la UI: '+errors.join('; '));
console.log('OK: registro/acceso, investigación, Sí/No seguridad, redacción, 5 Porqués, causa básica, consecuencia e informe');
await browser.close();
})().catch(err=>{console.error(err);process.exit(1)});
