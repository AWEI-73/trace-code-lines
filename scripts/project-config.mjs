import {posix} from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeGap,legacyGapIdentity,LEGACY_RAW_SHAPE} from './gap-shape.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const safe=p=>p&&p!=='.'&&!p.startsWith('../')&&!p.includes(':')&&!p.includes('\\')&&!posix.isAbsolute(p);

// Deliberately narrow: literal argv, exact root config names, no shell evaluation or dependency lookup.
export function projectCommandGap(command,file,line,{rows,read,sourceRoots=['.','src']}){
  if(!Array.isArray(command)||typeof command[0]!=='string')return null;
  const program=posix.basename(command[0].replaceAll('\\','/')).replace(/\.exe$/i,'');
  const python=['uv','poetry','pipx'].includes(program),node=['npx','npm'].includes(program);
  if(!python&&!node)return null;
  const configOnly=program==='uv'&&['sync','lock'].includes(command[1]);
  if(program!=='npx'&&command[1]!=='run'&&!configOnly)return null;
  if(program==='uv'&&command[1]==='run'&&typeof command[2]==='string'&&/^(?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?$/i.test(posix.basename(command[2].replaceAll('\\','/')))){
    const interpreter=normalizeGap({code:'SUBPROCESS_CWD_ENV_UNKNOWN',path:file,line,
      detail:{command,reason:'uv launches a Python interpreter; runtime cwd/env, interpreter selection and effects remain unknown'},
      resolution:'EXTERNAL_BINARY',target:{kind:'EXTERNAL_BINARY',name:command[2]},configCandidates:[]});
    // Before G40 (1.7), this exact argv produced a project-command target gap.
    const old={code:'SUBPROCESS_TARGET_UNKNOWN',path:file,line,detail:{command,reason:'Project command resolution depends on project configuration and runtime environment'}};
    for(const v of ['1.5.0','1.6.0'])interpreter.legacyIds[v]=legacyGapIdentity(old);
    interpreter[LEGACY_RAW_SHAPE]={code:old.code,detail:old.detail};
    return interpreter;
  }
  const name=configOnly?null:command[program==='npx'?1:2],configFile=python?'pyproject.toml':'package.json';
  const configHint={file:configFile,sections:python?['project.scripts','tool.poetry.scripts']:['scripts','bin'],name:typeof name==='string'?name:null,
    basis:'Root-local candidate only; runtime cwd, environment, installation and command flags remain unknown'};
  if(configOnly){configHint.operation=command[1];configHint.sections=['project','tool.uv'];}
  const gap=normalizeGap({code:'SUBPROCESS_TARGET_UNKNOWN',path:file,line,detail:{command,reason:'Project command resolution depends on project configuration and runtime environment'},
    resolution:'PROJECT_CONFIG_DEPENDENT',configHint,configCandidates:[]});
  if(typeof name!=='string'||!/^[A-Za-z0-9_@./-]+$/.test(name)||name.startsWith('-')||!rows.has(configFile))return gap;
  try{
    const body=read(configFile),source={file:configFile,sha256:hash(body)};configHint.source=source;
    const candidate=(section,value,targets)=>gap.configCandidates.push({candidate:true,runtimeVerified:false,name,section,value,source,
      targets:[...new Set(targets.filter(p=>safe(p)&&rows.has(p)))],resolution:'PROJECT_CONFIG_DEPENDENT'});
    if(python){
      let section='';for(const text of body.split(/\r?\n/)){
        const heading=text.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);if(heading){section=heading[1];continue;}
        if(!configHint.sections.includes(section))continue;
        const m=text.match(/^\s*(?:([A-Za-z0-9_-]+)|"([^"\\]+)"|'([^']+)')\s*=\s*(?:"([^"\\]+)"|'([^']+)')\s*(?:#.*)?$/);
        if(!m||(m[1]??m[2]??m[3])!==name)continue;
        const value=m[4]??m[5],module=value.match(/^([A-Za-z_]\w*(?:\.\w+)*):[A-Za-z_]\w*(?:\.\w+)*$/)?.[1];
        candidate(section,value,module?sourceRoots.flatMap(r=>[posix.join(r,module.replaceAll('.','/')+'.py'),posix.join(r,module.replaceAll('.','/'),'__init__.py')]):[]);
      }
    }else{
      const config=JSON.parse(body);
      for(const section of configHint.sections){
        const value=typeof config[section]==='object'&&config[section]!==null?config[section][name]:section==='bin'&&config.name===name?config.bin:null;
        if(typeof value!=='string')continue;
        const target=section==='bin'?value:value.match(/^\s*node\s+(?:"([^"\\]+)"|'([^']+)'|([^\s;&|]+))\s*$/)?.slice(1).find(Boolean);
        candidate(section,value,target?[posix.normalize(target)]:[]);
      }
    }
  }catch(e){configHint.readIssue=e.message;}
  return gap;
}
