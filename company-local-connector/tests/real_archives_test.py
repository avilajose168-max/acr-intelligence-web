import base64,hashlib,importlib.util,json,pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'windows'))
spec=importlib.util.spec_from_file_location('connector',pathlib.Path(__file__).parents[1]/'windows/acr_connector.py');c=importlib.util.module_from_spec(spec);sys.modules['connector']=c;spec.loader.exec_module(c)
import archive_runtime as ar
class ArchiveTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name)
  self.package={'schema':'acr-company-archive/1','company':{'name':'QA company'},'report':{'id':'ac200000-0000-4000-8000-000000000001','payload':{'title':'Informe real <script>alert(1)</script>','description':'Falla en bomba','photos':[{'data':'data:image/png;base64,'+base64.b64encode(b'image'*70000).decode()}],'actions':[{'description':'Cambiar sello','status':'Completado'}]}},'events':[{'kind':'execution','data':{'performed':'Sello reemplazado','files':[{'data':'data:application/pdf;base64,JVBERi0xLjQK'}]}}]}
  self.data=json.dumps(self.package,ensure_ascii=False).encode();self.hash=ar.digest(self.data);self.job={'id':'job','lease_id':'lease','kind':'write_archive','size':len(self.data),'checksum':self.hash,'relative_path':'ACR_Informes/2026/11/ac200000-0000-4000-8000-000000000001/'+self.hash+'/paquete.json'}
  self.binding={'connector_id':'connector','token':'secret','root_path':str(self.root)};self.calls=[];self.received=bytearray()
 def rpc(self,name,body):
  self.calls.append(body);op=body['p_op']
  if op=='download':return {'data':base64.b64encode(self.data[body['p_offset']:body['p_offset']+ar.CHUNK]).decode()}
  if op=='upload':
   self.assertEqual(len(self.received),body['p_offset']);self.received.extend(base64.b64decode(body['p_data']));return {}
  if op=='complete':self.assertEqual(bytes(self.received),self.data);return {'verified':True}
  raise AssertionError(op)
 def write(self):return ar.process(self.binding,self.job,self.rpc,c)
 def test_full_package_and_all_evidence_readback(self):
  self.write();folder=(self.root/self.job['relative_path']).parent
  self.assertEqual((folder/'paquete.json').read_bytes(),self.data);self.assertEqual((folder/'evidencia-002.pdf').read_bytes(),b'%PDF-1.4\n');self.assertEqual((folder/'evidencia-001.png').read_bytes(),b'image'*70000)
  report=(folder/'informe.html').read_text();self.assertIn('&lt;script&gt;',report);self.assertNotIn('<script>',report);manifest=json.loads((folder/'manifest.json').read_text());self.assertEqual(manifest['package_sha256'],self.hash)
  self.calls=[];self.received=bytearray();ar.process(self.binding,{**self.job,'kind':'read_archive'},self.rpc,c);self.assertNotIn('download',[x['p_op'] for x in self.calls]);self.assertEqual(bytes(self.received),self.data)
 def test_changed_evidence_prevents_verification(self):
  self.write();folder=(self.root/self.job['relative_path']).parent;(folder/'evidencia-002.pdf').write_bytes(b'changed');self.calls=[]
  with self.assertRaises(ValueError):ar.process(self.binding,{**self.job,'kind':'read_archive'},self.rpc,c)
  self.assertEqual(self.calls,[])
 def test_missing_original_prevents_cloud_fallback(self):
  self.write();(self.root/self.job['relative_path']).unlink();self.calls=[]
  with self.assertRaises(OSError):ar.process(self.binding,{**self.job,'kind':'read_archive'},self.rpc,c)
  self.assertEqual(self.calls,[])
 def test_corrupted_existing_file_never_overwritten(self):
  self.write();path=self.root/self.job['relative_path'];path.write_bytes(b'different');self.calls=[]
  with self.assertRaises(ValueError):self.write()
  self.assertEqual(path.read_bytes(),b'different');self.assertNotIn('complete',[x['p_op'] for x in self.calls])
 def test_checksum_and_traversal_rejected(self):
  for changes in [{'relative_path':'../paquete.json'},{'checksum':'0'*64},{'size':ar.LIMIT+1},{'kind':'delete_archive'}]:
   with self.subTest(changes=changes),self.assertRaises(ValueError):ar.process(self.binding,{**self.job,**changes},self.rpc,c)
 def test_external_evidence_not_falsely_backed_up(self):
  self.package['report']['payload']['photos']=[{'data':'https://example.invalid/photo.png'}]
  with self.assertRaises(ValueError):ar.outputs(json.dumps(self.package).encode())
 def test_symlink_evidence_rejected(self):
  self.write();path=(self.root/self.job['relative_path']).parent/'evidencia-002.pdf';path.unlink();other=self.root/'outside.pdf';other.write_bytes(b'%PDF-1.4\n');path.symlink_to(other)
  with self.assertRaises(ValueError):ar.process(self.binding,{**self.job,'kind':'read_archive'},self.rpc,c)
 def test_retry_identical_files_is_safe(self):self.write();self.calls=[];self.received=bytearray();self.assertTrue(self.write()['verified'])
if __name__=='__main__':unittest.main()
