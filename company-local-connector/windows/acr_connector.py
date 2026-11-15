"""ACR local connector pilot: outbound HTTPS, fixed probe files, Windows DPAPI."""
from __future__ import annotations
import argparse,base64,ctypes,ctypes.wintypes,getpass,hashlib,hmac,json,os,pathlib,re,stat,sys,time,urllib.error,urllib.request
import archive_runtime

API_URL='https://tfrgnqcspdlimdzluxds.supabase.co'
PUBLIC_KEY='sb_publishable_nP1O2b8Wjd2yJWNglfecXg_HPgrouuq'
MAX_BYTES=65536
PATH_PATTERN=re.compile(r'ACR_Conexion_Prueba/[0-9]{4}/(?:0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/informe\.html')
class APIError(Exception):
 def __init__(self,message,code=''):super().__init__(message);self.code=code
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
def rpc(name,body):
 allowed={'acr_local_connector_pair','acr_local_connector_poll','acr_local_connector_complete','acr_local_connector_fail','acr_archive_worker'}
 if name not in allowed:raise ValueError('Operacion no permitida.')
 req=urllib.request.Request(API_URL+'/rest/v1/rpc/'+name,data=json.dumps(body,ensure_ascii=False).encode('utf-8'),headers={'apikey':PUBLIC_KEY,'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.build_opener(NoRedirect()).open(req,timeout=25) as response:
   raw=response.read(600001)
   if len(raw)>600000:raise APIError('Respuesta demasiado grande.')
   return json.loads(raw)
 except urllib.error.HTTPError as error:
  try:info=json.loads(error.read(16384));message=info.get('message','El servidor rechazo la solicitud.');code=info.get('code','')
  except (ValueError,AttributeError):message='El servidor rechazo la solicitud.';code=''
  raise APIError(message,code) from None

class DataBlob(ctypes.Structure):
 _fields_=[('cbData',ctypes.wintypes.DWORD),('pbData',ctypes.POINTER(ctypes.c_ubyte))]
def dpapi(data:bytes,protect:bool)->bytes:
 if os.name!='nt':raise RuntimeError('La credencial de este conector se protege con Windows DPAPI. Ejecutalo en Windows.')
 crypt=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
 ptr=ctypes.POINTER(DataBlob);crypt.CryptProtectData.argtypes=[ptr,ctypes.c_wchar_p,ptr,ctypes.c_void_p,ctypes.c_void_p,ctypes.wintypes.DWORD,ptr];crypt.CryptProtectData.restype=ctypes.wintypes.BOOL
 crypt.CryptUnprotectData.argtypes=[ptr,ctypes.POINTER(ctypes.c_wchar_p),ptr,ctypes.c_void_p,ctypes.c_void_p,ctypes.wintypes.DWORD,ptr];crypt.CryptUnprotectData.restype=ctypes.wintypes.BOOL
 kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree.restype=ctypes.c_void_p
 buffer=(ctypes.c_ubyte*len(data)).from_buffer_copy(data);source=DataBlob(len(data),buffer);output=DataBlob()
 ok=crypt.CryptProtectData(ctypes.byref(source),'ACR Integrity connector',None,None,None,1,ctypes.byref(output)) if protect else crypt.CryptUnprotectData(ctypes.byref(source),None,None,None,None,1,ctypes.byref(output))
 if not ok:raise ctypes.WinError(ctypes.get_last_error())
 try:return ctypes.string_at(output.pbData,output.cbData)
 finally:kernel.LocalFree(ctypes.cast(output.pbData,ctypes.c_void_p))
def is_reparse(p:pathlib.Path)->bool:
 info=p.lstat();return stat.S_ISLNK(info.st_mode) or bool(getattr(info,'st_file_attributes',0)&0x400)
def verified_root(path)->pathlib.Path:
 p=pathlib.Path(path).absolute()
 if not p.is_dir():raise OSError('La carpeta configurada no existe o no esta disponible. Creala o conecta la unidad y vuelve a iniciar.')
 if is_reparse(p):raise OSError('La carpeta de prueba no debe ser un enlace o una redireccion del sistema.')
 return p.resolve(strict=True)
def target_file(root,relative,create=False):
 if not isinstance(relative,str) or not (PATH_PATTERN.fullmatch(relative) or archive_runtime.PATTERN.fullmatch(relative)):raise ValueError('Ruta rechazada: solo se admiten documentos autorizados de ACR Integrity.')
 base=verified_root(root);parts=relative.split('/');parent=base
 for part in parts[:-1]:
  parent=parent/part
  if create:
   try:parent.mkdir()
   except FileExistsError:pass
  if not parent.is_dir() or is_reparse(parent):raise OSError('Subcarpeta ausente o redirigida. No se accedio al archivo.')
 if os.path.commonpath([str(base),str(parent.resolve(strict=True))])!=str(base):raise ValueError('La ruta sale de la carpeta autorizada.')
 target=parent/parts[-1]
 if target.exists() and (is_reparse(target) or not target.is_file()):raise OSError('El destino no es un archivo regular autorizado.')
 return target
def read_disk(path):
 if is_reparse(path):raise OSError('Se rechazo un archivo redirigido.')
 flags=os.O_RDONLY|getattr(os,'O_BINARY',0)|getattr(os,'O_NOFOLLOW',0)
 with os.fdopen(os.open(str(path),flags),'rb') as stream:data=stream.read(MAX_BYTES+1)
 if len(data)>MAX_BYTES:raise ValueError('El archivo supera el limite de la prueba.')
 return data
def process_job(root,job):
 if not isinstance(job,dict) or job.get('kind') not in ('write_probe','read_probe'):raise ValueError('Operacion local no permitida.')
 expected=job.get('expected_hash','')
 if not re.fullmatch(r'[a-f0-9]{64}',expected):raise ValueError('Huella de archivo no valida.')
 writing=job['kind']=='write_probe';path=target_file(root,job.get('relative_path'),create=writing)
 if writing:
  encoded=job.get('content_base64')
  if not isinstance(encoded,str) or len(encoded)>100000:raise ValueError('Contenido de prueba no valido.')
  data=base64.b64decode(''.join(encoded.split()),validate=True)
  if len(data)>MAX_BYTES or not hmac.compare_digest(hashlib.sha256(data).hexdigest(),expected):raise ValueError('El contenido no coincide con la huella esperada.')
  try:
   flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0)|getattr(os,'O_NOFOLLOW',0)
   with os.fdopen(os.open(str(path),flags,0o600),'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
  except FileExistsError:
   # A retried lease can acknowledge the same bytes, never overwrite an edited file.
   if read_disk(path)!=data:raise OSError('Ya existe un archivo distinto. Se conservo sin reemplazarlo.')
 data=read_disk(path);checksum=hashlib.sha256(data).hexdigest()
 if not hmac.compare_digest(checksum,expected):raise ValueError('El archivo leido del disco no coincide. No se confirmo la operacion.')
 return {'p_readback':data.decode('utf-8',errors='strict'),'p_checksum':checksum}
def store_path(profile):
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}',profile):raise ValueError('Nombre de perfil invalido.')
 base=os.environ.get('LOCALAPPDATA')
 if not base:raise RuntimeError('No se encontro la carpeta privada de tu cuenta de Windows.')
 p=pathlib.Path(base)/'ACRIntegrityConnector'/profile;p.mkdir(parents=True,exist_ok=True);return p/'credential.bin'
def save_binding(path,binding):
 encrypted=dpapi(json.dumps(binding,ensure_ascii=False).encode('utf-8'),True);temp=path.with_suffix('.new')
 try:
  with open(temp,'wb') as stream:stream.write(encrypted);stream.flush();os.fsync(stream.fileno())
  os.replace(temp,path)
 finally:
  if temp.exists():temp.unlink()
def loop(binding,once=False,call=rpc,sleep=time.sleep):
 credentials={'p_connector':binding['connector_id'],'p_token':binding['token']};delay=15
 while True:
  try:
   response=call('acr_local_connector_poll',credentials);job=response.get('job');delay=15
   if job:
    lease={'p_job':job['id'],'p_lease':job['lease_id']}
    try:result=process_job(binding['root_path'],job)
    except (OSError,ValueError) as error:
     call('acr_local_connector_fail',{**credentials,**lease,'p_reason':str(error)[:300]});print('No se completo la prueba. Revisa el mensaje en la plataforma.',flush=True)
    else:
     call('acr_local_connector_complete',{**credentials,**lease,**result});print(('Guardado' if job['kind']=='write_probe' else 'Lectura')+' verificado: '+job['id'],flush=True)
   archived=call('acr_archive_worker',{**credentials,'p_op':'poll'}).get('job')
   if archived:
    try:archive_runtime.process(binding,archived,call,sys.modules[__name__])
    except (OSError,ValueError) as error:
     reason='No se pudo acceder al archivo local. Comprueba la carpeta y sus permisos.' if isinstance(error,OSError) else str(error)
     call('acr_archive_worker',{**credentials,'p_op':'fail','p_job':archived['id'],'p_lease':archived['lease_id'],'p_data':reason[:300]});print('Respaldo no completado. Revisa su estado en la plataforma.',flush=True)
    else:print('Respaldo real verificado: '+archived['id'],flush=True)
   if once:return
  except APIError as error:
   if error.code=='28000':raise
   print('El servidor no confirmo la solicitud. Se reintentara; los archivos locales se conservan.',flush=True);delay=min(delay*2,60)
  except (urllib.error.URLError,TimeoutError,ConnectionError,OSError):
   print('Sin conexion o carpeta no disponible. Se reintentara; los archivos locales se conservan.',flush=True);delay=min(delay*2,60)
  if once:return
  sleep(delay)
def main():
 parser=argparse.ArgumentParser(description='Conector local de prueba ACR Integrity');parser.add_argument('--pair',action='store_true');parser.add_argument('--once',action='store_true');parser.add_argument('--profile',default='prueba');args=parser.parse_args()
 if os.name!='nt':raise RuntimeError('Ejecuta este paquete en tu PC Windows. No instala un servicio ni abre puertos.')
 path=store_path(args.profile);binding=None
 if path.exists() and not args.pair:
  try:binding=json.loads(dpapi(path.read_bytes(),False))
  except Exception:raise RuntimeError('No se pudo abrir la credencial de esta cuenta de Windows. Usa VINCULAR_DE_NUEVO.cmd y un codigo nuevo.') from None
 if binding is None:
  print('En ACR Integrity: Empresas > Almacenamiento y servidor local > Generar codigo de vinculacion.')
  code=getpass.getpass('Pega el codigo de un solo uso y pulsa Enter (no se muestra): ').strip()
  binding=rpc('acr_local_connector_pair',{'p_code':code});save_binding(path,binding)
 print('\nEmpresa: '+binding['company_name']+'\nServidor: '+binding['server_name']+'\nCarpeta autorizada: '+binding['root_path'])
 verified_root(binding['root_path'])
 if input('Confirma que esta es la carpeta de la empresa para la prueba [S/N]: ').strip().lower() not in ('s','si','sí'):return
 print('\nConector VERSION 2 en ejecucion. Deja esta ventana abierta.\nProcesa las pruebas y respaldos reales autorizados por la empresa.\nNo se eliminan informes de la nube ni del disco. Ctrl+C detiene el conector.\n')
 loop(binding,args.once)
if __name__=='__main__':
 try:
  if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8',errors='replace')
  main()
 except KeyboardInterrupt:print('\nConector detenido. Los archivos locales se conservan.')
 except APIError as error:print('\n'+str(error));sys.exit(2)
 except Exception as error:print('\nNo se pudo iniciar o continuar: '+str(error));sys.exit(1)
