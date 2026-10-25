import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractWordText} from '../src/word.js';
test('Word preview extracts Thai body text without interpreting it as markup',async()=>{
 const file=await readFile(new URL('./fixtures/lesson.docx',import.meta.url));assert.equal(await extractWordText(file),'แผนการสอนตัวอย่าง Kru-Hub\nเรียนรู้เศษส่วนจากสิ่งรอบตัว');
});
test('Word preview rejects malformed archives and XML document type declarations',async()=>{
 await assert.rejects(extractWordText(Buffer.from('not a zip')),{status:400});
 await assert.rejects(extractWordText(await readFile(new URL('./fixtures/unsafe.docx',import.meta.url))),{status:400});
});
