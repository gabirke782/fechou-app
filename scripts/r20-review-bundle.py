"""Snapshot read-only for review. Never imports or executes downloaded projects."""
import hashlib, io, json, pathlib, shutil, subprocess, tarfile, urllib.request

root=pathlib.Path.cwd()
out=root/'review-bundle'
out.mkdir(exist_ok=True)
manifest=[]
def save(path,data,origin):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(data)
    try:
        text=data.decode('utf-8');lines=len(text.splitlines());kind='utf8'
    except UnicodeDecodeError:
        lines=None;kind='binary'
    manifest.append({'path':str(path.relative_to(out)),'origin':origin,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'git_blob_sha1':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),'kind':kind,'lines':lines})

# Only tracked files from the exact checked-out commit; do not collect credentials or runtime state.
for raw in subprocess.check_output(['git','ls-files','-z']).split(b'\0'):
    if not raw:continue
    rel=pathlib.Path(raw.decode())
    path=root/rel
    if path.is_symlink() or not path.is_file():raise RuntimeError('Unsupported tracked entry: '+str(rel))
    save(out/'repository'/rel,path.read_bytes(),'fechou-app checkout')

projects=[('google/csp-evaluator','ad530f3ae5473f9e03c8bf500ee0ada8d9e9b822'),('helmetjs/helmet','e91d88f6586656531df99816a2e26441feab0e45')]
for repo,commit in projects:
    url='https://codeload.github.com/'+repo+'/tar.gz/'+commit
    req=urllib.request.Request(url,headers={'User-Agent':'FECHOU-owned-security-review'})
    with urllib.request.urlopen(req,timeout=45) as response:data=response.read(15*1024*1024+1)
    if len(data)>15*1024*1024:raise RuntimeError('Archive too large')
    archive=tarfile.open(fileobj=io.BytesIO(data),mode='r:gz')
    for member in archive.getmembers():
        if member.isdir():continue
        if not member.isfile():raise RuntimeError('Refusing non-regular archive member')
        parts=pathlib.PurePosixPath(member.name).parts[1:]
        if not parts or any(p in ('..','.') for p in parts):raise RuntimeError('Invalid archive path')
        if member.size>8*1024*1024:raise RuntimeError('File too large')
        content=archive.extractfile(member).read()
        save(out/'third-party'/repo.replace('/','--')/pathlib.Path(*parts),content,repo+'@'+commit)

response_info=[]
for name,url in [('app','https://startup5.pages.dev/'),('admin','https://admpainel-6js.pages.dev/')]:
    req=urllib.request.Request(url,headers={'User-Agent':'FECHOU-owned-security-review','Cache-Control':'no-cache'})
    with urllib.request.urlopen(req,timeout=30) as response:
        body=response.read(6*1024*1024+1)
        if len(body)>6*1024*1024:raise RuntimeError('Live document too large')
        save(out/'live'/(name+'.html'),body,url)
        headers={k.lower():v for k,v in response.headers.items() if k.lower() not in ('set-cookie','cookie')}
        response_info.append({'url':response.url,'status':response.status,'headers':headers,'sha256':hashlib.sha256(body).hexdigest()})
(out/'live'/'headers.json').write_text(json.dumps(response_info,indent=2))
(out/'manifest.json').write_text(json.dumps({'projects':projects,'files':manifest},indent=2))
print(json.dumps({'files':len(manifest),'bytes':sum(x['bytes'] for x in manifest),'third_party_executed':False,'live_requests':'GET only'},indent=2))
