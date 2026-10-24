import fs from 'node:fs';
import {resolvePython} from './python-path.mjs';
import cp from 'node:child_process';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {walk,sha256} from './walker.mjs';
import {writerCandidates} from './language-static.mjs';
import {reconcile} from './coverage-reconcile.mjs';
export function languageChecks(root) {
  const checks=[],rows=new Map(),put=(p,v)=>{fs.mkdirSync(join(root,p,'..'),{recursive:true});const s=typeof v==='string'?v:JSON.stringify(v);fs.writeFileSync(join(root,p),s,'utf8');assert.equal(fs.readFileSync(join(root,p),'utf8'),s);rows.set(p,{path:p,sha256:sha256(s)});};
  for(const [p,s] of Object.entries({
    'cjs/main.cjs':"require('./exact'); require('./ext'); require('./mod'); require('./esm'); require('./data'); require('./dir'); require('./pkg'); require('./pkgdir'); require('fs'); require('third-party'); require.resolve('./resolved');\n// require('./fake')\nconst text=\"require('./fake')\";\n",
    'cjs/exact':'','cjs/exact.js':'','cjs/ext.js':'','cjs/ext.cjs':'','cjs/mod.cjs':'','cjs/esm.mjs':'','cjs/data.json':'{}',
    'cjs/dir/index.js':'','cjs/pkg/package.json':'{"main":"lib/start"}','cjs/pkg/lib/start.cjs':'',
    'cjs/pkgdir/package.json':'{"main":"lib"}','cjs/pkgdir/lib/index.cjs':'','cjs/resolved.js':'',
    'cjs/dynamic.cjs':"require(target);require('./'+name);module.createRequire(import.meta.url);require.resolve(target);",
    'cjs/escape.cjs':"require('../../outside');",
    'src/pkg/__init__.py':'from . import sub\n','src/pkg/sub.py':'from .x import value\nfrom . import sibling\n',
    'src/pkg/nested/__init__.py':'','src/pkg/nested/deep.py':'from ..other import z\n','src/pkg/other/__init__.py':'','src/pkg/other/z.py':'',
    'src/pkg/x.py':'value=1\n','src/pkg/sibling.py':'',
    'src/other/__init__.py':'','src/other/mod.py':'',
    'py-entry.py':'import pkg.sub, os as system\nimport pkg.nested.deep\nfrom other import (\n mod as mm,\n)\nimport requests\n',
    'py-dynamic.py':"importlib.import_module('pkg.x')\n__import__('other.mod')\nimportlib.import_module(prefix + name)\n__import__(name)\n",
    'py-subprocess.py':"subprocess.run(['python', 'child.py'])\nos.system('python -m pkg.x')\nsubprocess.Popen([sys.executable, '-m', 'other.mod'])\n",
    'child.py':'','py-comment.py':"# import absent\ns='import fake'\ntext=\"\"\"from fake import bad\nimport bad\"\"\"\n",
    'py-syspath.py':"sys.path.insert(0, dynamic_path)\n",
  }))put(p,s);
  let r=walk(root,['cjs/main.cjs'],rows);
  const names=r.files.map(f=>f.path).sort();
  assert.deepEqual(names,['cjs/main.cjs','cjs/exact','cjs/ext.js','cjs/mod.cjs','cjs/esm.mjs','cjs/data.json','cjs/dir/index.js','cjs/pkg/lib/start.cjs','cjs/pkgdir/lib/index.cjs','cjs/resolved.js'].sort());
  assert.equal(r.gaps.length,0);
  checks.push('CJS exact and ordered js/cjs/mjs/json extension probing','CJS directory index','CJS package main file and directory');
  assert(r.edges.some(e=>e.operation==='require.resolve'&&e.resolutionOnly));
  assert.deepEqual(r.external.map(e=>e.specifier).sort(),['node:fs','third-party']);
  checks.push('CJS require.resolve resolution evidence','CJS builtin and third-party external dependencies');
  r=walk(root,['cjs/dynamic.cjs'],rows);
  assert.equal(r.edges.filter(e=>e.kind==='DYNAMIC_COMPUTED').length,4);
  assert(r.gaps.some(e=>e.code==='CREATE_REQUIRE_BASE_UNRESOLVED'));
  assert(walk(root,['cjs/escape.cjs'],rows).gaps.some(e=>e.code==='CORE_PIN_UNSAFE_IMPORT'));
  checks.push('CJS computed require and module.createRequire gaps','CJS escape rejected and comment/string calls ignored');
  r=walk(root,['py-entry.py'],rows,{pythonSourceRoots:['.','src']});
  assert.deepEqual(r.files.map(f=>f.path).sort(),['py-entry.py','src/pkg/nested/__init__.py','src/pkg/nested/deep.py','src/pkg/other/__init__.py','src/pkg/other/z.py','src/pkg/__init__.py','src/pkg/sub.py','src/pkg/x.py','src/pkg/sibling.py','src/other/__init__.py','src/other/mod.py'].sort());
  assert.equal(r.gaps.length,0);
  assert.deepEqual(r.external.map(e=>e.specifier).sort(),['os','requests']);
  checks.push('Python absolute imports from configured source roots','Python relative imports and parent package imports','Python package __init__ and multiline from imports','Python stdlib and third-party external dependencies');
  r=walk(root,['py-dynamic.py'],rows,{pythonSourceRoots:['src']});
  assert.equal(r.edges.filter(e=>e.kind==='DYNAMIC_LITERAL').length,2);
  assert.equal(r.gaps.filter(e=>e.code==='DYNAMIC_COMPUTED').length,2);
  checks.push('Python importlib and __import__ literal/computed');
  r=walk(root,['py-subprocess.py'],rows,{pythonSourceRoots:['src']});
  assert.equal(r.edges.filter(e=>e.kind==='SUBPROCESS_ARG').length,3);
  assert(r.files.some(f=>f.path==='child.py'));assert(r.files.some(f=>f.path==='src/other/mod.py'));
  assert.equal(r.gaps.filter(g=>g.code==='SUBPROCESS_CWD_ENV_UNKNOWN').length,3);
  checks.push('Python subprocess script and python -m with cwd/env gaps');
  assert.equal(walk(root,['py-comment.py'],rows).edges.length,0);
  assert(walk(root,['py-syspath.py'],rows).gaps.some(g=>g.code==='PYTHON_SYS_PATH_MUTATION'));
  checks.push('Python comments/docstrings ignored and sys.path mutation disclosed');
  const writers=writerCandidates('writers.py',"open('a','w')\nopen('b',mode='a')\nopen('r','r')\nPath('x').write_text('t')\np.write_bytes(b'data')\njson.dump(data, stream)\nshutil.copy2(src,dst)\nshutil.move(src,dst)\nos.replace(src,dst)\nos.rename(src,dst)\nc.execute('INSERT INTO t VALUES (1)')\nc.execute('SELECT * FROM t')\nc.execute(sql)\n");
  assert.equal(writers.length,12);
  assert.deepEqual(writers.filter(w=>w.snippet.startsWith('c.execute')).map(w=>w.operation),['DB_WRITE_CANDIDATE','DB_READ','CONTAINER_MUTATION_CANDIDATE']);
  assert(writers.every(w=>w.status==='STATIC_CANDIDATE'));assert(writers.filter(w=>!['DB_WRITE_CANDIDATE','DB_READ'].includes(w.operation)).every(w=>w.resolvedEndpoint==='UNKNOWN'));
  checks.push('Python file writers and literal SQL classification with unknown connections');
  const entry=join(root,'trace-entry.py'),outside=join(root,'trace-outside.py');
  const source="def unused():\n    return 0\ntotal = 0\nfor n in range(3):\n    total += n\nexec(compile('other = 1\\n', outside, 'exec'))\n";
  put('trace-entry.py',source);put('trace-outside.py','other = 1\n');
  const python=resolvePython();
  const collector=[
    'import sys, json',
    'payload=json.loads(sys.stdin.read())',
    'counts={}',
    'def tracer(frame,event,arg):',
    '    filename=frame.f_code.co_filename',
    '    if event=="line" and filename in payload["paths"]:',
    '        key=(filename,frame.f_lineno)',
    '        counts[key]=counts.get(key,0)+1',
    '    return tracer',
    'sys.settrace(tracer)',
    'try:',
    '    exec(compile(payload["source"],payload["entry"],"exec"),{"__name__":"__main__","outside":payload["outside"]})',
    'finally:',
    '    sys.settrace(None)',
    'files=[{"path":p,"lines":[{"line":line,"count":count} for (filename,line),count in sorted(counts.items()) if filename==p]} for p in payload["paths"]]',
    'print(json.dumps({"schema":"python-settrace-v1","files":files,"collector":"stdlib sys.settrace","synthetic":True}))'
  ].join('\n');
  const raw=cp.execFileSync(python,['-I','-B','-X','utf8','-c',collector],{encoding:'utf8',input:JSON.stringify({entry,outside,source,paths:[entry,outside]}),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1'},stdio:['pipe','pipe','pipe']});
  const parsed=JSON.parse(raw);
  assert.equal(parsed.files[0].lines.find(l=>l.line===5).count,3);
  assert(!parsed.files[0].lines.some(l=>l.line===2));
  put('python-coverage/raw.json',raw);put('python-static.json',{closures:[{files:['trace-entry.py','never.py']}]});put('python-endpoints.json',{endpoints:[]});
  const rc=reconcile({coverageDirectory:join(root,'python-coverage'),staticMap:join(root,'python-static.json'),endpointTable:join(root,'python-endpoints.json'),roots:[{root,scope:'source'}]});
  assert.deepEqual(rc.threeWay.a,['trace-entry.py']);assert.deepEqual(rc.threeWay.b,['trace-outside.py']);assert.deepEqual(rc.threeWay.c,['never.py']);assert.equal(rc.files.find(f=>f.path==='trace-entry.py').lineCounts[5],3);
  checks.push('Python real stdlib sys.settrace synthetic collection','Python reconcile a/b/c and repeated line counts');

  put('py-syntax.py',"from other import (\n mod,\n)\nfrom pkg import \\\n sibling\nraise ValueError('x') from exc\nyield from generator()\ns = '''one\\\ntwo'''\nimport missinglib\n");
  r=walk(root,['py-syntax.py'],rows,{pythonSourceRoots:['src']});
  assert(!r.gaps.some(g=>g.code==='PYTHON_IMPORT_SYNTAX'));assert(r.files.some(f=>f.path==='src/pkg/sibling.py'));assert(r.external.some(e=>e.specifier==='missinglib'&&e.line===10));
  put('py-external.py',"subprocess.run(['ffmpeg', '-i', source])\nos.system('git status')\nsubprocess.run([computed, 'x'])\n");
  r=walk(root,['py-external.py'],rows);assert.deepEqual(r.external.filter(e=>e.kind==='EXTERNAL_COMMAND').map(e=>e.program),['ffmpeg','git']);assert.equal(r.gaps.filter(g=>g.code==='SUBPROCESS_TARGET_UNKNOWN').length,1);
  put('scripts/path-root.py',"ROOT = Path(__file__).resolve().parents[1] / 'extra'\nsys.path.insert(0, str(ROOT))\nimport chosen\nsys.path.append(os.path.join(os.path.dirname(__file__), '..', 'extra'))\nsys.path.append(dynamic)\n");
  put('extra/chosen.py','');
  r=walk(root,['scripts/path-root.py'],rows,{pythonSourceRoots:['.']});assert(r.files.some(f=>f.path==='extra/chosen.py'));assert.equal(r.edges.filter(e=>e.kind==='PYTHON_SOURCE_ROOT').length,2);assert.equal(r.gaps.filter(g=>g.code==='PYTHON_SYS_PATH_MUTATION').length,1);
  put('path-escape.py',"sys.path.append(Path(__file__).parent.parent)\n");
  assert(walk(root,['path-escape.py'],rows).gaps.some(g=>g.code==='PYTHON_SYS_PATH_OUTSIDE_ROOT'));
  checks.push('Python multiline and explicit continuation imports; yield/raise from excluded','Python escaped newline preserves source line locator','literal external commands listed; computed executable remains gap','file-relative sys.path literal roots resolve with evidence; computed/outside stay gaps');

  return checks;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node language-self-test.mjs (equal external TEMP/TMP required)");process.exit(0);}
  process.on('uncaughtException',e=>{console.error(e.message);process.exitCode=1;});

  const temp=process.env.TEMP;assert(temp&&process.env.TMP===temp,'Set equal TEMP/TMP');
  const root=fs.mkdtempSync(join(temp,'language-self-test-'));
  try{console.log(JSON.stringify({status:'PASS',synthetic:true,checks:languageChecks(root)}));}
  finally{const r=relative(resolve(temp),resolve(root));assert(r&&!r.startsWith('..')&&!isAbsolute(r)&&r.startsWith('language-self-test-'));fs.rmSync(resolve(root),{recursive:true,force:true});}
}
