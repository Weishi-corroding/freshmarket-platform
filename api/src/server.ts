import { buildApp } from './app.js';
const {app}=await buildApp();
try {await app.listen({port:Number(process.env.PORT || 3001),host:process.env.HOST || '127.0.0.1'});}
catch(error){app.log.error(error);process.exit(1);}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{app.close().then(()=>process.exit(0));});
