import base64,hashlib,importlib.util,pathlib,tempfile,unittest,sys
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'windows'))
spec=importlib.util.spec_from_file_location('connector',pathlib.Path(__file__).parents[1]/'windows/acr_connector.py');c=importlib.util.module_from_spec(spec);sys.modules['connector']=c;spec.loader.exec_module(c)
class ConnectorTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);self.data='<html>Conexión de prueba</html>'.encode();self.job={'id':'job','lease_id':'lease','kind':'write_probe','relative_path':'ACR_Conexion_Prueba/2026/11/ac100000-0000-4000-8000-000000000001/informe.html','expected_hash':hashlib.sha256(self.data).hexdigest(),'content_base64':base64.b64encode(self.data).decode()}
 def test_write_read_and_retry(self):
  result=c.process_job(self.root,self.job);self.assertEqual(result['p_readback'],self.data.decode());self.assertEqual(c.process_job(self.root,self.job),result)
  read={**self.job,'kind':'read_probe','content_base64':None};self.assertEqual(c.process_job(self.root,read),result)
 def test_changed_file_never_overwritten(self):
  c.process_job(self.root,self.job);p=self.root/self.job['relative_path'];p.write_bytes(b'changed')
  with self.assertRaises(OSError):c.process_job(self.root,self.job)
  self.assertEqual(p.read_bytes(),b'changed')
  with self.assertRaises(ValueError):c.process_job(self.root,{**self.job,'kind':'read_probe','content_base64':None})
 def test_reject_unknown_paths_and_operations(self):
  for change in [{'relative_path':'../secret'},{'relative_path':'C:/secret'},{'kind':'delete'},{'expected_hash':'bad'}]:
   with self.subTest(change=change),self.assertRaises(ValueError):c.process_job(self.root,{**self.job,**change})
 def test_reject_oversize_and_invalid_hash(self):
  for data in [b'wrong',b'x'*65537]:
   with self.assertRaises(ValueError):c.process_job(self.root,{**self.job,'content_base64':base64.b64encode(data).decode()})
 def test_reject_redirected_folder(self):
  with tempfile.TemporaryDirectory() as outside:
   (self.root/'ACR_Conexion_Prueba').symlink_to(outside,target_is_directory=True)
   with self.assertRaises(OSError):c.process_job(self.root,self.job)
 def test_loop_only_acknowledges_actual_disk(self):
  calls=[]
  def rpc(name,body):
   calls.append((name,body));return {'job':self.job} if name.endswith('_poll') else {}
  binding={'connector_id':'connector','token':'secret','root_path':str(self.root)};c.loop(binding,once=True,call=rpc)
  completed=[body for name,body in calls if name.endswith('_complete')];self.assertEqual(completed[0]['p_checksum'],self.job['expected_hash'])
  (self.root/self.job['relative_path']).unlink();self.job.update(kind='read_probe',content_base64=None);calls.clear();c.loop(binding,once=True,call=rpc)
  self.assertTrue(any(n.endswith('_fail') for n,_ in calls));self.assertFalse(any(n.endswith('_complete') for n,_ in calls))
 def test_profile_traversal_rejected(self):
  with self.assertRaises(ValueError):c.store_path('../other')
 def test_redirects_disabled(self):self.assertIsNone(c.NoRedirect().redirect_request(None,None,None,None,None,None))
if __name__=='__main__':unittest.main()
