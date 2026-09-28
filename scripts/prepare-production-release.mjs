// Offline only. Incomplete policy produces a blocked checklist, never placeholder transactions.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {keccak256,toUtf8Bytes} from 'ethers';
import {compile} from './compile.mjs';
import solc from 'solc';
import {validateReleasePolicy,prepareRelease} from './production-release.mjs';
const policyPath=process.argv[2]??'config/production-release.template.json';
const output=process.argv[3]??'research/production/release-preparation';
try{
 if(['manifest.json','standard-input.json'].some(name=>resolve(policyPath).toLowerCase()===resolve(output,name).toLowerCase()))throw new Error('INVALID_OUTPUT');
 const policy=JSON.parse(await readFile(policyPath,'utf8')),net=JSON.parse(await readFile('config/networks.json','utf8')),assets=JSON.parse(await readFile('config/meme-candidates.json','utf8')).assets;
 const build=compile(),compiled=JSON.parse(await readFile('artifacts/build.json','utf8'));
 // Verification input contains only production sources and their external dependencies.
 // The normal build also compiles pilot/test fixtures; those must not appear in release material.
 const input=structuredClone(compiled.input);
 for(const source of Object.keys(input.sources))if(!source.startsWith('contracts/production/'))delete input.sources[source];
 for(const source of Object.keys(compiled.output.sources))if(!source.startsWith('contracts/')&&!input.sources[source])input.sources[source]={content:await readFile('node_modules/'+source,'utf8')};
 console.log('Checking self-contained verification input against compiled candidates.');
 const rebuilt=JSON.parse(solc.compile(JSON.stringify(input)));
 if((rebuilt.errors??[]).some(x=>x.severity==='error'))throw new Error('VERIFICATION_INPUT_FAILED');
 const verifiedContracts=[];
 for(const name of policy.governanceMode==='immediate-eoa'?['ImmediateAdmin','ImmediateAdapter','ImmediateOFT']:['BridgeTimelock','GovernedAdapter','GovernedOFT']){
  const key='contracts/production/'+name+'.sol',expected=build[key][name],actual=rebuilt.contracts[key][name];
  if(actual.evm.bytecode.object!==expected.evm.bytecode.object||actual.evm.deployedBytecode.object!==expected.evm.deployedBytecode.object)throw new Error('BUILD_NOT_REPRODUCIBLE');
  verifiedContracts.push({source:key,contract:name,creationBytecodeHash:keccak256('0x'+actual.evm.bytecode.object),runtimeTemplateHash:keccak256('0x'+actual.evm.deployedBytecode.object)});
 }
 const validation=validateReleasePolicy(policy,assets);
 const result=validation.valid?await prepareRelease(build,policy,net,assets):{status:'BLOCKED_MISSING_OR_INVALID_POLICY',issues:validation.issues,deployments:[],note:policy.governanceMode==='direct-eoa'?'No real deployer, governor, guardian or asset limits have been approved in this template.':'No real deployer, Safe, guardian or asset limits have been approved in this template.'};
 result.compiler=compiled.compiler;result.sourceInputHash=keccak256(toUtf8Bytes(JSON.stringify(input)));result.lockfileHash=keccak256(await readFile('package-lock.json'));
 result.verificationInputRecompiled=true;result.verifiedContracts=verifiedContracts;
 result.preparedAt=new Date().toISOString();
 await mkdir(output,{recursive:true});await writeFile(output+'/standard-input.json',JSON.stringify(input,null,2)+'\n');await writeFile(output+'/manifest.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,deployments:result.deployments.length,issues:result.issues??[],output}));
}catch{console.error('Release preparation failed; policy/provider details omitted.');process.exitCode=1;}
