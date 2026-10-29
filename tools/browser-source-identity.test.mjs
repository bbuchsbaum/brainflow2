import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesCommittedBytes} from './browser-source-identity.mjs';
test('raw committed fixtures require identical bytes',()=>{
 assert.equal(matchesCommittedBytes(Buffer.from([0,255,2]),Buffer.from([0,255,2])),true);
 assert.equal(matchesCommittedBytes(Buffer.from([0,255,2]),Buffer.from([0,255,3])),false);
});
test('LFS content must match independently known SHA-256 and size',()=>{
 const pointer=Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\nsize 3\n');
 assert.equal(matchesCommittedBytes(pointer,Buffer.from('abc')),true);
 assert.equal(matchesCommittedBytes(pointer,Buffer.from('abd')),false);
 assert.equal(matchesCommittedBytes(pointer,Buffer.from('abcd')),false);
});
test('a pointer-like comment is not an LFS identity',()=>{
 assert.equal(matchesCommittedBytes(Buffer.from('oid sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\nsize 3'),Buffer.from('abc')),false);
});
