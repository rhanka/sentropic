import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire('/workspace/api/package.json');
try {
  const { Client } = require('pg');
  const { S3Client, HeadObjectCommand, GetObjectCommand, GetObjectAclCommand } = require('@aws-sdk/client-s3');
  const e = process.env;
  const db = new Client({connectionString:e.DATABASE_URL,options:'-c default_transaction_read_only=on -c statement_timeout=20000'});
  await db.connect();
  console.log(JSON.stringify((await db.query("SELECT current_database(),current_setting('default_transaction_read_only'),clock_timestamp()")).rows));
  const {rows} = await db.query("SELECT 'document' AS source,storage_key AS key,NULL::text AS bucket,size_bytes AS bytes FROM context_documents WHERE coalesce(storage_key,'')<>'' UNION ALL SELECT 'version',storage_key,NULL,size_bytes FROM context_document_versions WHERE coalesce(storage_key,'')<>'' UNION ALL SELECT 'job',r->>'storageKey',r->>'storageBucket',CASE WHEN r->>'byteLength' ~ '^[0-9]+$' THEN (r->>'byteLength')::bigint END FROM (SELECT CASE WHEN result IS JSON THEN result::jsonb ELSE '{}'::jsonb END r FROM job_queue) j WHERE coalesce(r->>'storageKey','')<>''");
  await db.end();
  const bucket = e.DOC_STORAGE_BUCKET?.trim();
  console.log(JSON.stringify({backend:e.ARTIFACT_STORE_BACKEND?.trim() || (bucket?'s3':'local-fs'),bucketConfigured:!!bucket,referenceCount:rows.length}));
  if (!bucket) { console.log(JSON.stringify({status:'no_configured_bucket',objectsVerified:0})); process.exit(0); }
  const client = new S3Client({region:e.DOC_STORAGE_REGION||'fr-par-1',endpoint:e.DOC_STORAGE_ENDPOINT||undefined,forcePathStyle:true,credentials:{accessKeyId:e.DOC_STORAGE_ACCESS_KEY,secretAccessKey:e.DOC_STORAGE_SECRET_KEY}});
  const results = new Map();
  for (const row of rows) {
    const Bucket = row.bucket || bucket, Key = row.key;
    const group = results.get(row.source) || {source:row.source,references:0,heads:0,downloads:0,bytes:0,sizeMismatches:0,publicGrants:0,nonOwnerGrants:0,aclRead:0,anonymousReadable:0,failures:{},digests:[]};
    results.set(row.source,group); group.references++;
    try {
      const head = await client.send(new HeadObjectCommand({Bucket,Key})); group.heads++;
      if (row.bytes!=null && Number(row.bytes)!==head.ContentLength) group.sizeMismatches++;
      const object = await client.send(new GetObjectCommand({Bucket,Key}));
      const hash = createHash('sha256'); let bytes=0;
      for await (const chunk of object.Body) {bytes+=chunk.length; hash.update(chunk);}
      group.downloads++; group.bytes+=bytes; group.digests.push(hash.digest('hex'));
      try {
        const acl = await client.send(new GetObjectAclCommand({Bucket,Key})); group.aclRead++;
        for (const grant of acl.Grants||[]) {
          if (grant.Grantee?.URI?.match(/AllUsers|AuthenticatedUsers/)) group.publicGrants++;
          if (grant.Grantee?.ID && grant.Grantee.ID!==acl.Owner?.ID) group.nonOwnerGrants++;
        }
      } catch (err) { const name='acl:'+String(err.name).replace(/[^A-Za-z0-9_:]/g,''); group.failures[name]=(group.failures[name]||0)+1; }
      const url=new URL(e.DOC_STORAGE_ENDPOINT); url.pathname=`/${encodeURIComponent(Bucket)}/${Key.split('/').map(encodeURIComponent).join('/')}`;
      const response=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(10000),redirect:'error'});
      if(response.ok) group.anonymousReadable++;
    } catch(err) {const name=String(err.name).replace(/[^A-Za-z0-9_:]/g,'');group.failures[name]=(group.failures[name]||0)+1;}
  }
  for(const group of results.values()) {
    group.contentDigestSetSha256=createHash('sha256').update(group.digests.sort().join('\n')+'\n').digest('hex');
    delete group.digests; console.log(JSON.stringify(group));
  }
} catch(err) {console.log(JSON.stringify({status:'probe_failed',errorClass:String(err.name).replace(/[^A-Za-z0-9_:]/g,'')}));process.exitCode=1;}
