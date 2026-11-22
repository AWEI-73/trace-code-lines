import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// True when this module is the script node was started with. Compares real paths so a
// symlinked install path (e.g. a skills folder linked elsewhere) still runs the CLI instead
// of silently doing nothing with exit code 0.
export function isMain(url){
 const arg=process.argv[1];if(!arg)return false;
 try{return realpathSync(arg)===realpathSync(fileURLToPath(url));}catch{return false;}
}
