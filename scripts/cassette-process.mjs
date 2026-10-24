const r=JSON.parse(Buffer.from(process.env.TRACE_CASSETTE_RESPONSE,'base64').toString());
process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');process.exitCode=r.exitCode??0;
