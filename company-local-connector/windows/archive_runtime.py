"""Versioned company report bundles; all paths are generated, never user filenames."""
import base64,hashlib,html,json,os,pathlib,re
CHUNK=262144
LIMIT=33554432
PATTERN=re.compile(r'ACR_Informes/[0-9]{4}/(?:0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}/paquete\.json')
MIMES={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf'}
def digest(data):return hashlib.sha256(data).hexdigest()
def outputs(data):
 package=json.loads(data.decode('utf-8'))
 if package.get('schema')!='acr-company-archive/1' or not isinstance(package.get('report',{}).get('payload'),dict):raise ValueError('El paquete no tiene el formato de respaldo esperado.')
 files={};evidence=[]
 def walk(value,path=''):
  if isinstance(value,dict):
   for key,item in value.items():walk(item,path+'/'+str(key))
  elif isinstance(value,list):
   for i,item in enumerate(value):walk(item,path+'/'+str(i))
  elif isinstance(value,str) and value.startswith('data:'):
   match=re.fullmatch(r'data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)',value)
   if not match or match[1] not in MIMES:raise ValueError('Hay una evidencia con formato no admitido. El original se conserva en la nube.')
   raw=base64.b64decode(''.join(match[2].split()),validate=True)
   if len(raw)>LIMIT or len(files)>=300:raise ValueError('Demasiadas evidencias o tamaño no admitido.')
   name='evidencia-'+str(len(files)+1).zfill(3)+'.'+MIMES[match[1]];files[name]=raw;evidence.append({'file':name,'source':path,'mime':match[1],'sha256':digest(raw),'size':len(raw)})
  elif isinstance(value,str) and path.rsplit('/',1)[-1] in ('data','logo_data') and value and not value.startswith('data:'):
   raise ValueError('Una evidencia es un enlace externo. No se declara respaldada sin descargar su contenido.')
 walk(package)
 p=package['report']['payload'];e=lambda value:html.escape(str(value or ''),quote=True)
 sections=[]
 for label,field in [('Equipo','equipment'),('Área','area'),('Sector','sector'),('Unidad productiva','productionUnit'),('Fecha del evento','datetime'),('Tipo de falla','failureType'),('Investigador','author'),('Qué ocurrió','description'),('Seguridad','safetyDescription'),('Acción de seguridad','safetyAction'),('Cronología','timeline'),('Causa básica','basicCause'),('Consecuencia','causeConsequence'),('Conclusión','conclusion'),('Acciones realizadas','appliedCorrectiveActions')]:
  sections.append('<h2>'+label+'</h2><p>'+e(p.get(field))+'</p>')
 sections.append('<h2>5 Porqués</h2><ol>'+''.join('<li>'+e(x)+'</li>' for x in p.get('whys',[]))+'</ol><h2>Plan de acción</h2>')
 for a in p.get('actions',[]):sections.append('<p>'+e(a.get('description'))+' · '+e(a.get('owner'))+' · '+e(a.get('due'))+' · '+e(a.get('status'))+'</p>')
 sections.append('<h2>Historial de revisión, ejecución y efectividad</h2>')
 for event in package.get('events',[]):
  d=event.get('data',{});sections.append('<h3>'+e(event.get('kind'))+' · '+e(event.get('created_at'))+'</h3><p>'+e(d.get('reviewer') or d.get('actorLabel'))+' · '+e(d.get('result'))+'</p><p>'+e(d.get('notes') or d.get('performed'))+'</p>')
 sections.append('<h2>Evidencias y logo incluidos</h2>')
 for asset in evidence:
  sections.append('<p><a href="'+asset['file']+'">'+asset['file']+'</a> · '+e(asset['source'])+'</p>')
  if asset['mime'].startswith('image/'):sections.append('<img src="'+asset['file']+'" alt="Evidencia archivada">')
 document='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\';img-src \'self\' data:;style-src \'unsafe-inline\'"><title>'+e(p.get('title'))+'</title><style>body{font:15px Arial;max-width:1000px;margin:30px auto;padding:20px;color:#153047}p{white-space:pre-wrap;overflow-wrap:anywhere}h2{font-size:18px;border-bottom:1px solid #adc0ca;padding-top:15px}img{max-width:100%;max-height:600px}li{margin:12px 0}</style><h1>'+e(package.get('company',{}).get('name'))+'</h1><h2>'+e(p.get('title'))+'</h2><p>Versión archivada · '+digest(data)+'</p>'+''.join(sections)+'</html>'
 files['informe.html']=document.encode('utf-8')
 manifest={'schema':'acr-local-manifest/1','package_sha256':digest(data),'package_size':len(data),'evidence':evidence,'files':{name:{'sha256':digest(raw),'size':len(raw)} for name,raw in files.items()}}
 files['manifest.json']=json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2).encode('utf-8')
 return files
def regular_read(path,core):
 if core.is_reparse(path):raise ValueError('Se rechazó un archivo redirigido.')
 with os.fdopen(os.open(str(path),os.O_RDONLY|getattr(os,'O_BINARY',0)|getattr(os,'O_NOFOLLOW',0)),'rb') as stream:data=stream.read(LIMIT+1)
 if len(data)>LIMIT:raise ValueError('El archivo supera 32 MB.')
 return data
def save_new(path,data,core):
 try:
  with os.fdopen(os.open(str(path),os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0)|getattr(os,'O_NOFOLLOW',0),0o600),'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
 except FileExistsError:
  if regular_read(path,core)!=data:raise ValueError('Ya existe un archivo distinto. Se conservó sin reemplazarlo.')
def process(binding,job,call,core):
 if job.get('kind') not in ('write_archive','read_archive') or not PATTERN.fullmatch(job.get('relative_path','')):raise ValueError('Ruta u operación de respaldo rechazada.')
 size=job.get('size');checksum=job.get('checksum','')
 if not isinstance(size,int) or not 1<=size<=LIMIT or not re.fullmatch('[a-f0-9]{64}',checksum) or job['relative_path'].split('/')[-2]!=checksum:raise ValueError('Metadatos de respaldo inválidos.')
 # target_file validates every directory; it accepts only this exact versioned pattern.
 path=core.target_file(binding['root_path'],job['relative_path'],create=job['kind']=='write_archive')
 args={'p_connector':binding['connector_id'],'p_token':binding['token'],'p_job':job['id'],'p_lease':job['lease_id']}
 def request(op,**kwargs):return call('acr_archive_worker',{**args,'p_op':op,**kwargs})
 if job['kind']=='write_archive':
  parts=[]
  for off in range(0,size,CHUNK):
   value=request('download',p_offset=off);raw=base64.b64decode(''.join(value['data'].split()),validate=True)
   if len(raw)!=min(CHUNK,size-off):raise ValueError('Bloque incompleto. No se confirmó el respaldo.')
   parts.append(raw)
  data=b''.join(parts)
  if digest(data)!=checksum:raise ValueError('El paquete recibido no coincide con su huella.')
  derived=outputs(data);save_new(path,data,core)
  for name,raw in derived.items():save_new(path.parent/name,raw,core)
 data=regular_read(path,core)
 if len(data)!=size or digest(data)!=checksum:raise ValueError('El paquete del disco fue modificado o está incompleto.')
 for name,raw in outputs(data).items():
  if regular_read(path.parent/name,core)!=raw:raise ValueError('Una evidencia o el informe local no coincide con su manifiesto.')
 for off in range(0,size,CHUNK):request('upload',p_offset=off,p_data=base64.b64encode(data[off:off+CHUNK]).decode())
 result=request('complete',p_checksum=checksum)
 if not result.get('verified'):raise ValueError('El servidor no confirmó la verificación.')
 return result
