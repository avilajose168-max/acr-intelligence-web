"""Original protocols/procedures stored on company disk; verified binary relay."""
import base64,hashlib,json,os,re
CHUNK=262144
LIMIT=10485760
PATTERN=re.compile(r'ACR_Documentos/(?:Protocolos|Procedimientos)/[0-9]{4}/(?:0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}/documento\.(?:pdf|docx?|xlsx?|png|jpe?g|webp)')
def digest(data):return hashlib.sha256(data).hexdigest()
def read(path,core):
 if core.is_reparse(path):raise ValueError('El archivo no puede ser un enlace o una redireccion.')
 with os.fdopen(os.open(str(path),os.O_RDONLY|getattr(os,'O_BINARY',0)|getattr(os,'O_NOFOLLOW',0)),'rb') as stream:data=stream.read(LIMIT+1)
 if len(data)>LIMIT:raise ValueError('El documento supera 10 MB.')
 return data
def save(path,data,core):
 try:
  with os.fdopen(os.open(str(path),os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0)|getattr(os,'O_NOFOLLOW',0),0o600),'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
 except FileExistsError:
  if read(path,core)!=data:raise ValueError('Hay un archivo distinto en el destino. Se conserva sin reemplazarlo.')
def process(binding,job,call,core):
 relative=job.get('relative_path','');size=job.get('size');checksum=job.get('checksum','')
 if job.get('kind') not in ('work_write','work_read') or not PATTERN.fullmatch(relative):raise ValueError('Ruta u operacion de documento no permitida.')
 if type(size) is not int or not 1<=size<=LIMIT or not re.fullmatch('[a-f0-9]{64}',checksum) or relative.split('/')[-2]!=checksum or relative.split('/')[-3]!=job.get('document_id'):raise ValueError('Los datos del documento no coinciden con su version.')
 writing=job['kind']=='work_write';path=core.target_file(binding['root_path'],relative,create=writing)
 args={'p_connector':binding['connector_id'],'p_token':binding['token'],'p_job':job['id'],'p_lease':job['lease_id']}
 def request(op,**kwargs):return call('acr_work_document_worker',{**args,'p_op':op,**kwargs})
 manifest=json.dumps({'schema':'acr-work-document/1','document_id':job['document_id'],'file':path.name,'sha256':checksum,'size':size},sort_keys=True).encode()
 if writing:
  parts=[]
  for off in range(0,size,CHUNK):
   value=request('download',p_offset=off);raw=base64.b64decode(''.join(value['data'].split()),validate=True)
   if len(raw)!=min(CHUNK,size-off):raise ValueError('Bloque incompleto. No se confirma el guardado.')
   parts.append(raw)
  data=b''.join(parts)
  if digest(data)!=checksum:raise ValueError('El archivo recibido no coincide con su huella.')
  save(path,data,core);save(path.parent/'manifest.json',manifest,core)
 # Every read comes from disk. Read jobs cannot request a cloud download.
 data=read(path,core)
 if len(data)!=size or digest(data)!=checksum:raise ValueError('El documento del servidor fue modificado o esta incompleto.')
 if read(path.parent/'manifest.json',core)!=manifest:raise ValueError('El manifiesto local no coincide con el documento.')
 for off in range(0,size,CHUNK):request('upload',p_offset=off,p_data=base64.b64encode(data[off:off+CHUNK]).decode())
 result=request('complete',p_checksum=checksum)
 if not result.get('verified'):raise ValueError('La plataforma no confirmo la verificacion.')
 return result
