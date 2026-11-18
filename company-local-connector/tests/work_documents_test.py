import base64,hashlib,importlib.util,pathlib,tempfile,unittest,sys
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'windows'))
import document_runtime as d
spec=importlib.util.spec_from_file_location('doccore',pathlib.Path(__file__).parents[1]/'windows/acr_connector.py');core=importlib.util.module_from_spec(spec);sys.modules['doccore']=core;spec.loader.exec_module(core)
class WorkDocuments(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);self.data=b'%PDF-1.7\x00\xff\x80'+b'content'*80000;self.hash=hashlib.sha256(self.data).hexdigest();self.doc='ad300000-0000-4000-8000-000000000001';self.job={'id':'job','lease_id':'lease','kind':'work_write','document_id':self.doc,'relative_path':f'ACR_Documentos/Protocolos/2026/11/{self.doc}/{self.hash}/documento.pdf','size':len(self.data),'checksum':self.hash};self.binding={'root_path':str(self.root),'connector_id':'cid','token':'secret'};self.calls=[];self.received=bytearray()
 def call(self,name,b):
  self.assertEqual(name,'acr_work_document_worker');self.calls.append(b['p_op'])
  if b['p_op']=='download':return {'data':base64.b64encode(self.data[b['p_offset']:b['p_offset']+d.CHUNK]).decode()}
  if b['p_op']=='upload':
   self.assertEqual(b['p_offset'],len(self.received));self.received.extend(base64.b64decode(b['p_data']));return {}
  if b['p_op']=='complete':self.assertEqual(bytes(self.received),self.data);return {'verified':True}
  self.fail('unexpected op')
 def process(self,job=None):return d.process(self.binding,job or self.job,self.call,core)
 def test_binary_write_and_disk_read_without_cloud_fallback(self):
  self.assertTrue(self.process()['verified']);self.assertEqual((self.root/self.job['relative_path']).read_bytes(),self.data);self.calls.clear();self.received.clear();self.process({**self.job,'kind':'work_read'});self.assertNotIn('download',self.calls);self.assertIn('complete',self.calls)
 def test_same_file_retry_and_word_original(self):
  self.job['relative_path']=self.job['relative_path'].replace('Protocolos','Procedimientos').replace('.pdf','.docx');self.process();self.received.clear();self.process()
 def test_modified_document_never_overwritten_or_acknowledged(self):
  self.process();path=self.root/self.job['relative_path'];path.write_bytes(b'changed');self.calls.clear();self.received.clear()
  with self.assertRaises(ValueError):self.process()
  self.assertEqual(path.read_bytes(),b'changed');self.assertNotIn('complete',self.calls)
 def test_missing_or_changed_local_manifest_blocks_read(self):
  self.process();p=(self.root/self.job['relative_path']).parent/'manifest.json';p.write_bytes(b'changed');self.calls.clear();self.received.clear()
  with self.assertRaises(ValueError):self.process({**self.job,'kind':'work_read'})
  self.assertNotIn('complete',self.calls);self.assertNotIn('download',self.calls)
 def test_missing_disk_file_never_fetches_cloud(self):
  with self.assertRaises(OSError):self.process({**self.job,'kind':'work_read'})
  self.assertEqual(self.calls,[])
 def test_reject_paths_and_metadata(self):
  for changes in [{'relative_path':'../secret'},{'kind':'delete'},{'size':10485761},{'checksum':'bad'},{'document_id':'other'}]:
   with self.subTest(changes=changes),self.assertRaises(ValueError):self.process({**self.job,**changes})
 def test_reject_redirected_folder(self):
  with tempfile.TemporaryDirectory() as outside:
   (self.root/'ACR_Documentos').symlink_to(outside,target_is_directory=True)
   with self.assertRaises(OSError):self.process()
if __name__=='__main__':unittest.main()
