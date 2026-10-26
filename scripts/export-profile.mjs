if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: node export-profile.mjs input.json output.json');process.exit(0);}
// Optional adapter only. Never invoked by check-card or the default workflow.
import fs from 'node:fs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node export-profile.mjs check-card.json proposal.json');
const c=JSON.parse(fs.readFileSync(input,'utf8'));
if(c.schema!=='check-card-v1')throw Error('Invalid card');
fs.writeFileSync(output,JSON.stringify({schema:'profile-proposal-v1',status:'PROPOSAL_ONLY',title:c.title,entries:c.entries,inputs:c.inputs,outputs:c.outputs,tools:c.tools,limits:c.limits,requiresOwnerReview:true},null,2)+'\n','utf8');
