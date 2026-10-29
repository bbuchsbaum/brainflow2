import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

/** Compare actual build inputs, including LFS pointers and legacy raw blobs. */
export function matchesCommittedBytes(committed, actual) {
  if(committed.equals(actual)) return true;
  const pointer=committed.toString('utf8');
  if(!pointer.startsWith('version https://git-lfs.github.com/spec/v1\n'))return false;
  const oid=/^oid sha256:([a-f0-9]{64})$/m.exec(pointer)?.[1];
  const size=/^size (\d+)$/m.exec(pointer)?.[1];
  return !!oid && Number(size)===actual.length && createHash('sha256').update(actual).digest('hex')===oid;
}
export function sourceIdentity(root) {
  const status=spawnSync('git',['status','--porcelain','--untracked-files=normal','--','.',':!**/node_modules/**',':!**/dist/**'],{cwd:root,encoding:'utf8'});
  if(status.status!==0)throw new Error('Unable to inspect build source identity');
  const entries=status.stdout.split('\n').filter(Boolean);
  const sourceChanges=[], verifiedFilterDifferences=[];
  for(const entry of entries){
    // Only tracked modification flags can be filter artefacts. Renames,
    // deletions and untracked inputs conservatively count as changes.
    if(![' M','M ','MM'].includes(entry.slice(0,2))){sourceChanges.push(entry);continue;}
    const path=entry.slice(3);
    const head=spawnSync('git',['show',`HEAD:${path}`],{cwd:root,maxBuffer:256*1024*1024});
    try {
      if(head.status===0 && matchesCommittedBytes(head.stdout,readFileSync(resolve(root,path)))){
        verifiedFilterDifferences.push(path);continue;
      }
    }catch{}
    sourceChanges.push(entry);
  }
  return {sourceDirty:sourceChanges.length>0,sourceChanges,verifiedFilterDifferences};
}
