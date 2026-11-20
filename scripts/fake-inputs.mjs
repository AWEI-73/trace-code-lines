// Small, synthetic trial inputs per format (no dependencies). Every good file carries MARKER so the
// trial can tell whether the content really came through to the output.
import zlib from 'node:zlib';
export const MARKER='Trial Report 2026';
const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=b=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
// zip with deflate entries (enough for .docx / .xlsx / .pptx readers)
export function zip(files){const parts=[],central=[];let off=0;
 for(const [name,text] of Object.entries(files)){const raw=Buffer.from(text,'utf8'),data=zlib.deflateRawSync(raw),nm=Buffer.from(name),crc=crc32(raw);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(nm.length,26);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(nm.length,28);c.writeUInt32LE(off,42);
  parts.push(h,nm,data);central.push(c,nm);off+=30+nm.length+data.length;}
 const cd=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(central.length/2,8);e.writeUInt16LE(central.length/2,10);e.writeUInt32LE(cd.length,12);e.writeUInt32LE(off,16);
 return Buffer.concat([...parts,cd,e]);}
const docx=()=>zip({'[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
 '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/document.xml':'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+MARKER+'</w:t></w:r></w:p><w:p><w:r><w:t>Amy, 30, Taipei</w:t></w:r></w:p></w:body></w:document>'});
function pdf(){const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const stream='BT /F1 14 Tf 20 150 Td ('+MARKER+') Tj ET';objs[3]='<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream';
 let out='%PDF-1.4\n';const xref=[];objs.forEach((o,i)=>{xref.push(out.length);out+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});
 const x=out.length;out+='xref\n0 '+(objs.length+1)+'\n0000000000 65535 f \n'+xref.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objs.length+1)+' /Root 1 0 R >>\nstartxref\n'+x+'\n%%EOF\n';return Buffer.from(out,'latin1');}
const FORMATS={
 csv:{ext:'.csv',good:()=>'name,age,city\nAmy,30,Taipei\nBob,25,"Kaohsiung, TW"\n',bad:()=>'name,age\n"Amy,30\nBob,25,extra,,\n'},
 json:{ext:'.json',good:()=>'{"posts": [{"id": 1, "title": "hello"}, {"id": 2, "title": "world"}]}\n',bad:()=>'{"posts": [{"id": 1,}\n'},
 docx:{ext:'.docx',good:docx,bad:()=>Buffer.from('PK\u0003\u0004 this is not a real docx\n')},
 pdf:{ext:'.pdf',good:pdf,bad:()=>Buffer.from('%PDF-1.4\n garbage, no objects\n')},
 html:{ext:'.html',good:()=>'<!doctype html><html><head><title>t</title></head><body><h1>'+MARKER+'</h1><p>Amy, 30, Taipei</p></body></html>\n',bad:()=>'<html><body><h1>unclosed <p <<<\n'},
 md:{ext:'.md',good:()=>'# '+MARKER+'\n\nAmy, 30, Taipei\n',bad:()=>'\u0000\u0001\n'},
 sql:{ext:'.sql',good:()=>"select name, age from people where city = 'Taipei' and note = '"+MARKER+"';\n",bad:()=>"selec from ((( where 'unterminated\n"},
 txt:{ext:'.txt',good:()=>MARKER+'\nAmy, 30, Taipei\n',bad:()=>'\u0000\u0001not valid\n'},
};
// Which format the sentence is about: explicit words first (DOCX, PDF, HTML …), then CSV/JSON.
export function formatOf(question=''){const q=question.toLowerCase();
 for(const [k,re] of [['docx',/docx|word 檔|word檔|\.doc\b/],['pdf',/pdf/],['html',/html|網頁/],['sql',/\bsql\b/],['csv',/csv/],['md',/markdown 檔|\.md\b/],['json',/json/]])if(re.test(q))return k;return null;}
export function fakeInput(fmt){const f=FORMATS[fmt]??FORMATS.txt;return {ext:f.ext,good:f.good(),bad:f.bad(),fmt:FORMATS[fmt]?fmt:'txt'};}
