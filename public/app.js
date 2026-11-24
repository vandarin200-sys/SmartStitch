(function(){
"use strict";

var SS_ROOT = document.getElementById('ss-root') || document;
var $ = function(id){ return SS_ROOT.querySelector('#'+id) || document.getElementById(id); };
var files = [];
var zipUrl = null;
var zipBlob = null;
var zipEntries = [];
var previewUrls = [];
var resultToken = 0;
var currentZipName = 'SmartStitch.zip';
var busy = false;
var maxFiles = 200;

var KEY = 'smartstitch_web_profiles_v1';
var defaultSettings = {
  profile_name:'Settings Profile 1',
  direction:'vertical', grid_mode:'custom', image_count:4,
  split_height:5000, output_type:'.tga', lossy_quality:100,
  detector_type:1, senstivity:90, ignorable_pixels:5, scan_step:5,
  enforce_type:2, enforce_width:720,
  resize_width:48, resize_height:48, resize_method:'fit',
  ico_sizes:[16,32,48,64,128,256],
  zip_name:'SmartStitch', slice_start:'01', last_browse_location:''
};
var defaultProfiles = [Object.assign({},defaultSettings)];
var store = loadStore();

function sanitizeZipName(v){
  return String(v==null?'':v).trim().replace(/\.zip$/i,'').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+/,'').slice(0,60) || defaultSettings.zip_name;
}
function zipFileName(v){ return sanitizeZipName(v)+'.zip'; }
function sanitizeSliceStart(v){
  var raw=String(v==null?'':v).trim();
  if(!/^\d+$/.test(raw)) return defaultSettings.slice_start;
  var width=Math.min(raw.length,9);
  var number=Math.min(999999999,Math.max(1,parseInt(raw,10)));
  var text=String(number);
  while(text.length<width) text='0'+text;
  return text;
}
var current = Math.min(store.current||0, store.profiles.length-1);

function normalizeIcoSizes(value){
  var allowed = [16,32,48,64,128,256];
  var list = [];
  if(Array.isArray(value)) list = value;
  else if(typeof value==='string' && value.trim()){
    var text = value.trim();
    if(text.charAt(0)==='['){
      try{ var parsed=JSON.parse(text); if(Array.isArray(parsed)) list=parsed; }catch(e){ list=[]; }
    }else{
      list = text.split(',');
    }
  }
  var out = [];
  list.forEach(function(v){ var n=Math.trunc(Number(v)); if(allowed.indexOf(n)>=0 && out.indexOf(n)<0) out.push(n); });
  return out.sort(function(a,b){ return a-b; });
}
function normalizeProfile(p){
  var s = Object.assign({},defaultSettings,p&&p.settings?p.settings:null,p);
  s.profile_name = s.profile_name || s.name || defaultSettings.profile_name;
  s.direction = s.direction === 'horizontal' ? 'horizontal' : 'vertical';
  s.grid_mode = s.grid_mode === 'count' ? 'count' : (s.grid_mode === 'resize' ? 'resize' : 'custom');
  s.image_count = Math.round(clamp(+s.image_count,1,1000,defaultSettings.image_count));
  s.output_type = s.output_type || defaultSettings.output_type;
  s.split_height = clamp(+s.split_height,1,999999999,defaultSettings.split_height);
  s.lossy_quality = clamp(+s.lossy_quality,1,100,defaultSettings.lossy_quality);
  s.detector_type = +s.detector_type === 0 ? 0 : 1;
  s.senstivity = clamp(+s.senstivity,1,100,defaultSettings.senstivity);
  s.scan_step = clamp(+s.scan_step,1,25,defaultSettings.scan_step);
  s.ignorable_pixels = clamp(+s.ignorable_pixels,0,999999,defaultSettings.ignorable_pixels);
  s.enforce_type = clamp(+s.enforce_type,0,2,defaultSettings.enforce_type);
  s.enforce_width = clamp(+s.enforce_width,1,999999999,defaultSettings.enforce_width);
  s.resize_width = Math.round(clamp(+s.resize_width,1,10000,defaultSettings.resize_width));
  s.resize_height = Math.round(clamp(+s.resize_height,1,10000,defaultSettings.resize_height));
  s.resize_method = (s.resize_method==='fit'||s.resize_method==='fill'||s.resize_method==='stretch') ? s.resize_method : 'fit';
  s.ico_sizes = normalizeIcoSizes(s.ico_sizes);
  s.zip_name = sanitizeZipName(s.zip_name || defaultSettings.zip_name);
  s.slice_start = sanitizeSliceStart(s.slice_start);
  return s;
}
function loadStore(){
  try{
    var raw = localStorage.getItem(KEY);
    if(raw){
      var o = JSON.parse(raw);
      if(o && o.profiles && o.profiles.length){
        return {current:Math.min(o.current||0,o.profiles.length-1), profiles:o.profiles.map(normalizeProfile)};
      }
    }
  }catch(e){}
  return {current:0, profiles:[Object.assign({},defaultSettings)]};
}
function saveStore(){ try{ localStorage.setItem(KEY, JSON.stringify(store)); }catch(e){} }
function cur(){ return store.profiles[current]; }
function val(v,d){ return (v==null||v==='')?d:v; }
function readIcoSizes(){
  var out=[];
  var box=$('icoSizes');
  if(box) Array.prototype.forEach.call(box.querySelectorAll('input[type=checkbox]'),function(c){
    if(c.checked) out.push(parseInt(c.value,10));
  });
  return normalizeIcoSizes(out);
}
function writeIcoSizes(sizes){
  var box=$('icoSizes');
  if(!box) return;
  var selected=normalizeIcoSizes(sizes);
  Array.prototype.forEach.call(box.querySelectorAll('input[type=checkbox]'),function(c){
    c.checked = selected.indexOf(parseInt(c.value,10))>=0;
  });
}
function readSettings(){
  return {
    direction:$('direction').value,
    grid_mode:$('gridMode').value,
    image_count:Math.round(clamp(+$('imageCount').value,1,1000,4)),
    output_type:$('outputType').value,
    lossy_quality:clamp(+$('quality').value,1,100,100),
    split_height:clamp(+$('height').value,1,999999999,5000),
    enforce_type:+$('enforce').value,
    enforce_width:clamp(+$('customWidth').value,1,999999999,720),
    detector_type:+$('detector').value,
    senstivity:clamp(+$('sensitivity').value,1,100,90),
    scan_step:clamp(+$('scanStep').value,1,25,5),
    ignorable_pixels:clamp(+$('ignoreMargin').value,0,999999,5),
    resize_width:Math.round(clamp(+$('resizeWidth').value,1,10000,48)),
    resize_height:Math.round(clamp(+$('resizeHeight').value,1,10000,48)),
    resize_method:$('resizeMethod').value,
    ico_sizes:readIcoSizes(),
    zip_name:sanitizeZipName($('zipName')?$('zipName').value:''),
    slice_start:sanitizeSliceStart($('sliceStart')?$('sliceStart').value:'')
  };
}
function writeSettings(s){
  s = s || defaultSettings;
  $('direction').value = s.direction === 'horizontal' ? 'horizontal' : 'vertical';
  $('gridMode').value = s.grid_mode === 'count' ? 'count' : (s.grid_mode === 'resize' ? 'resize' : 'custom');
  $('imageCount').value = val(s.image_count,4);
  $('outputType').value = val(s.output_type,'.tga');
  $('quality').value = val(s.lossy_quality,100);
  $('height').value = val(s.split_height,5000);
  $('enforce').value = String(val(s.enforce_type,2));
  $('customWidth').value = val(s.enforce_width,720);
  $('detector').value = String(val(s.detector_type,1));
  $('sensitivity').value = val(s.senstivity,90);
  $('scanStep').value = val(s.scan_step,5);
  $('ignoreMargin').value = val(s.ignorable_pixels,5);
  $('resizeWidth').value = val(s.resize_width,48);
  $('resizeHeight').value = val(s.resize_height,48);
  $('resizeMethod').value = s.resize_method==='fill'||s.resize_method==='stretch' ? s.resize_method : 'fit';
  writeIcoSizes(s.ico_sizes);
  if($('zipName')) $('zipName').value = s.zip_name||defaultSettings.zip_name;
  if($('sliceStart')) $('sliceStart').value = s.slice_start||defaultSettings.slice_start;
  syncConditional();
}
function clamp(v,a,b,d){ return isFinite(v)?Math.min(b,Math.max(a,v)):d; }
function log(m){ var l=$('log'); l.textContent += m+'\n'; l.scrollTop=l.scrollHeight; }
function toast(m){ var t=$('toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(function(){t.classList.remove('show');},2600); }
function setStatus(m,p){ $('status').textContent=m; if(p!=null) $('bar').style.width=Math.max(0,Math.min(100,p))+'%'; }
function naturalCompare(a,b){
  var ax=/(\d+|\D+)/g, bx=/(\d+|\D+)/g, A=a.toLowerCase().match(ax), B=b.toLowerCase().match(ax);
  for(var i=0;i<Math.min(A.length,B.length);i++){
    if(A[i]!==B[i]) return (/^\d/.test(A[i])?parseInt(A[i],10)-parseInt(B[i],10):A[i]<B[i]?-1:1);
  }
  return A.length-B.length;
}
function formatBytes(n){
  if(n<1024) return n+' B';
  if(n<1048576) return (n/1024).toFixed(1)+' KB';
  return (n/1048576).toFixed(1)+' MB';
}
function u16At(view,offset,little){
  if(offset<0||offset+2>view.byteLength) return 0;
  return view.getUint16(offset,!!little);
}
function u32At(view,offset,little){
  if(offset<0||offset+4>view.byteLength) return 0;
  return view.getUint32(offset,!!little);
}
function tagAt(view,offset,count){
  var out='';
  for(var i=0;i<count && offset+i<view.byteLength;i++) out+=String.fromCharCode(view.getUint8(offset+i));
  return out;
}
function parseImageDimensions(buffer){
  var v=new DataView(buffer);
  if(v.byteLength<12) return null;
  if(v.byteLength>=24 && v.getUint32(0,false)===0x89504e47 && tagAt(v,1,3)==='PNG'){
    return {width:u32At(v,16,false),height:u32At(v,20,false)};
  }
  if(v.byteLength>=10 && tagAt(v,0,3)==='GIF'){
    return {width:u16At(v,6,true),height:u16At(v,8,true)};
  }
  if(v.byteLength>=26 && tagAt(v,0,2)==='BM'){
    return {width:Math.abs(v.getInt32(18,true)),height:Math.abs(v.getInt32(22,true))};
  }
  var tgaType=viewByte(v,2);
  if(v.byteLength>=16 && viewByte(v,0)===0 && (tgaType===2||tgaType===3||tgaType===10||tgaType===11)){
    return {width:u16At(v,12,true),height:u16At(v,14,true)};
  }
  if(v.byteLength>=22 && tagAt(v,0,4)==='8BPS'){
    return {width:u32At(v,18,false),height:u32At(v,14,false)};
  }
  if(v.getUint16(0,false)===0xffd8){
    var o=2;
    while(o<v.byteLength-9){
      if(viewByte(v,o)!==0xff){ o++; continue; }
      while(o<v.byteLength && viewByte(v,o)===0xff) o++;
      var marker=viewByte(v,o++);
      if(marker===0xd8||marker===0xd9) continue;
      if(marker===0xda) break;
      var len=u16At(v,o,false);
      if(len<2) break;
      if(marker>=0xc0 && marker<=0xcf && marker!==0xc4 && marker!==0xc8 && marker!==0xcc){
        return {width:u16At(v,o+5,false),height:u16At(v,o+3,false)};
      }
      o+=len;
    }
  }
  if(tagAt(v,0,4)==='RIFF' && tagAt(v,8,4)==='WEBP'){
    var chunk=tagAt(v,12,4);
    if(chunk==='VP8X'){
      return {
        width:1+viewByte(v,24)+(viewByte(v,25)<<8)+(viewByte(v,26)<<16),
        height:1+viewByte(v,27)+(viewByte(v,28)<<8)+(viewByte(v,29)<<16)
      };
    }
    if(chunk==='VP8 '){
      return {width:u16At(v,26,true)&0x3fff,height:u16At(v,28,true)&0x3fff};
    }
    if(chunk==='VP8L' && viewByte(v,20)===0x2f){
      var b1=viewByte(v,21), b2=viewByte(v,22), b3=viewByte(v,23), b4=viewByte(v,24);
      return {
        width:1+b1+((b2&0x3f)<<8),
        height:1+((b2&0xc0)>>6)+(b3<<2)+((b4&0x0f)<<10)
      };
    }
  }
  var endian=tagAt(v,0,2);
  if(endian==='II'||endian==='MM'){
    var le=endian==='II';
    if(u16At(v,2,le)!==42) return null;
    var ifd=u32At(v,4,le), count=u16At(v,ifd,le), w=0, h=0;
    for(var i=0;i<count;i++){
      var e=ifd+2+i*12;
      if(e+12>v.byteLength) break;
      var tag=u16At(v,e,le), type=u16At(v,e+4,le), total=u32At(v,e+6,le);
      if(total!==1 || (type!==3 && type!==4)) continue;
      var size=type===3?u16At(v,e+8,le):u32At(v,e+8,le);
      if(tag===256) w=size;
      if(tag===257) h=size;
    }
    if(w&&h) return {width:w,height:h};
  }
  return null;
}
function viewByte(view,offset){
  return (offset>=0&&offset<view.byteLength)?view.getUint8(offset):0;
}
function readImageDimensions(file){
  var bytes=file.slice(0,Math.min(file.size,2*1024*1024));
  if(!bytes || !bytes.arrayBuffer) return Promise.resolve(null);
  return bytes.arrayBuffer().then(function(buf){
    var d=parseImageDimensions(buf);
    return d && d.width>0 && d.height>0 ? d : null;
  }).catch(function(){ return null; });
}
function dimensionLabel(dims){
  return dims && dims.width && dims.height ? dims.width+'×'+dims.height : '—';
}
function updateZipNamePreview(){
  var el=$('zipNamePreview');
  if(!el) return;
  var input=$('zipName');
  el.textContent=zipFileName(input?input.value:'');
}
function updateSliceStartPreview(){
  var el=$('sliceStartPreview');
  if(!el) return;
  var input=$('sliceStart');
  var start=sanitizeSliceStart(input?input.value:'');
  var width=start.length;
  var number=parseInt(start,10);
  var ext=$('outputType').value;
  var names=[];
  for(var i=0;i<3;i++){
    var n=String(number+i);
    while(n.length<width) n='0'+n;
    names.push(n+ext);
  }
  el.textContent=names.join(' · ');
}
function updateFmtHint(){
  var f=$('outputType').value;
  var lossy = (f==='.jpg'||f==='.jpeg'||f==='.webp'||f==='.tiff');
  var ico = f==='.ico';
  $('qualityWrap').style.display = lossy ? 'flex' : 'none';
  if($('icoGridFields')) $('icoGridFields').style.display = ico ? 'grid' : 'none';
  $('fmtHint').textContent = ico
    ? 'ICO disusun dari PNG ber-alpha, mendukung beberapa resolusi, dan maksimal 256 px per sisi.'
    : (lossy ? 'Kualitas diterapkan saat ekspor.' : 'Format ini tidak menggunakan pengaturan kualitas.');
  updateZipNamePreview();
  updateSliceStartPreview();
  updateResizePreview();
}
function updateDirectionLabels(){
  var horizontal = $('direction').value === 'horizontal';
  if($('directionHint')){
    var countMode = $('gridMode') && $('gridMode').value === 'count';
    $('directionHint').textContent = countMode
      ? (horizontal
        ? 'Jumlah Gambar: gambar disusun kiri ke kanan dengan lebih banyak kolom.'
        : 'Jumlah Gambar: gambar disusun atas ke bawah dengan lebih banyak baris.')
      : (horizontal
        ? (files.length === 2
          ? 'Dua gambar disusun berdampingan; gambar kedua otomatis mengikuti ukuran gambar pertama.'
          : 'Gambar disusun kiri ke kanan dan dipotong mengikuti lebar.')
        : 'Gambar disusun atas ke bawah dan dipotong mengikuti tinggi.');
  }
  if($('heightLabel')) $('heightLabel').textContent = horizontal ? 'Perkiraan Lebar Potongan' : 'Perkiraan Tinggi Potongan';
  if($('heightHint')) $('heightHint').textContent = horizontal
    ? 'Perkiraan lebar setiap potongan.'
    : 'Perkiraan tinggi setiap potongan.';
  if($('enforceLabel')) $('enforceLabel').textContent = 'Penyesuaian Ukuran';
  if($('customWidthLabel')) $('customWidthLabel').textContent = horizontal
    ? 'Tinggi Kustom (px)'
    : 'Lebar Kustom (px)';
}
function gridShapeFor(count,direction){
  var n=Math.round(clamp(+count,1,1000,4));
  var vertical=(direction||'vertical')!=='horizontal';
  var best=null;
  for(var smaller=1;smaller*smaller<=n;smaller++){
    if(n%smaller!==0) continue;
    if(smaller===1&&n>2) continue;
    var larger=n/smaller, diff=larger-smaller;
    if(!best||diff<best.diff) best={smaller:smaller,larger:larger,diff:diff};
  }
  var rows, cols;
  if(best){
    rows=vertical?best.larger:best.smaller;
    cols=vertical?best.smaller:best.larger;
  }else{
    var side=Math.max(1,Math.round(Math.sqrt(n)));
    var other=Math.ceil(n/side);
    rows=vertical?other:side;
    cols=vertical?side:other;
  }
  var columnsPerRow=[], remaining=n;
  for(var r=0;r<rows;r++){
    var rowCols=Math.ceil(remaining/(rows-r));
    columnsPerRow.push(rowCols);
    remaining-=rowCols;
  }
  var maxCols=Math.max.apply(null,columnsPerRow);
  return {rows:rows,cols:maxCols,columnsPerRow:columnsPerRow,exact:!!best,count:n};
}
function updateGridModeFields(){
  var mode=$('gridMode') ? $('gridMode').value : 'custom';
  var countMode=mode==='count';
  var resizeMode=mode==='resize';
  if($('customGridFields')) $('customGridFields').style.display=countMode||resizeMode?'none':'grid';
  if($('countGridFields')) $('countGridFields').style.display=countMode?'grid':'none';
  if($('resizeGridFields')) $('resizeGridFields').style.display=resizeMode?'grid':'none';
  if($('resizePreview')) $('resizePreview').style.display=resizeMode?'grid':'none';
  if($('directionWrap')) $('directionWrap').style.display=resizeMode?'none':'flex';
  if($('detectorGroup')) $('detectorGroup').style.display=resizeMode?'none':'block';
  if($('sliceStartField')) $('sliceStartField').style.display=resizeMode?'none':'flex';
  if($('gridShapePreview')){
    var direction=$('direction')&&$('direction').value==='horizontal'?'horizontal':'vertical';
    var shape=gridShapeFor($('imageCount')?$('imageCount').value:4,direction);
    $('gridShapePreview').textContent = (shape.exact
      ? shape.count+' potongan → '+shape.rows+' baris × '+shape.cols+' kolom'
      : shape.count+' potongan → '+shape.rows+' baris, kolom per baris: '+shape.columnsPerRow.join(', '))+' · '+(direction==='horizontal'?'horizontal':'vertikal');
  }
}
function syncConditional(){
  updateDirectionLabels();
  updateGridModeFields();
  $('customWrap').style.display = ($('enforce').value==='2')?'flex':'none';
  $('smartOpts').style.display = ($('detector').value==='1')?'grid':'none';
  updateFmtHint();
  updateResizePreview();
}
function updateResizePreview(){
  var table=$('resizeTable');
  var summary=$('resizeSummary');
  if(!table||!summary) return;
  if($('gridMode').value!=='resize') return;
  var width=Math.round(clamp(+$('resizeWidth').value,1,10000,48));
  var height=Math.round(clamp(+$('resizeHeight').value,1,10000,48));
  var method=$('resizeMethod').value;
  var methodLabels={fit:'Fit',fill:'Fill',stretch:'Stretch'};
  var ext=$('outputType').value;
  var extra=ext==='.ico' ? ' · '+readIcoSizes().length+' resolusi ICO' : '';
  summary.textContent = files.length+' gambar diproses individual → '+width+'×'+height+' px · '+(methodLabels[method]||'Fit')+' · '+ext+extra;
  var rows=['<div class="ss-resize-row head"><span>Nama Berkas</span><span>Dimensi Asli</span><span>Dimensi Hasil</span></div>'];
  if(!files.length){
    rows.push('<div class="ss-resize-empty">Belum ada gambar. Tambahkan gambar untuk melihat pratinjau.</div>');
  }else{
    files.forEach(function(x){
      rows.push('<div class="ss-resize-row"><span title="'+escapeHtml(x.relativePath||x.name)+'">'+escapeHtml(x.name)+'</span><span>'+dimensionLabel(x.dimensions)+'</span><span>'+width+'×'+height+'</span></div>');
    });
  }
  table.innerHTML=rows.join('');
}

Array.prototype.forEach.call(document.querySelectorAll('.ss-tab'),function(btn){
  btn.addEventListener('click',function(){
    Array.prototype.forEach.call(document.querySelectorAll('.ss-tab'),function(b){
      var active=b===btn;
      b.classList.toggle('active',active);
      b.setAttribute('aria-selected',String(active));
      b.setAttribute('tabindex',active?'0':'-1');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ss-panel'),function(p){p.classList.remove('active');});
    $('panel-'+btn.dataset.panel).classList.add('active');
  });
});

var drop=$('drop'), input=$('files'), folderInput=$('folderInput');
drop.addEventListener('click',function(){ input.click(); });
input.addEventListener('change',function(){ addFiles(input.files); input.value=''; });
if($('folderButton')) $('folderButton').addEventListener('click',function(){ folderInput.click(); });
if(folderInput) folderInput.addEventListener('change',function(){ addFiles(folderInput.files); folderInput.value=''; });
['dragenter','dragover'].forEach(function(ev){ drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('drag');}); });
['dragleave','drop'].forEach(function(ev){ drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('drag');}); });
drop.addEventListener('drop',function(e){ if(e.dataTransfer&&e.dataTransfer.files) addFiles(e.dataTransfer.files); });

function addFiles(list){
  var arr=Array.prototype.slice.call(list);
  var ok=arr.filter(function(f){ return /\.(png|jpe?g|jfif|webp|bmp|tiff?|tga|ps[bd])$/i.test(f.name); });
  if(!ok.length){ toast('Format berkas tidak didukung.'); return; }
  var remaining=maxFiles-files.length;
  if(remaining<=0){ toast('Maksimal '+maxFiles+' gambar.'); return; }
  if(ok.length>remaining){
    toast('Hanya '+remaining+' gambar lagi yang bisa ditambahkan (maksimal '+maxFiles+').');
    ok=ok.slice(0,remaining);
  }
  ok=ok.map(function(f){
    return {file:f, name:f.name, size:f.size, relativePath:f.webkitRelativePath||f.name, dimensions:null};
  });
  files=files.concat(ok);
  files.sort(function(a,b){ return naturalCompare(a.relativePath,b.relativePath); });
  renderFiles();
  ok.forEach(function(x){
    readImageDimensions(x.file).then(function(dims){
      x.dimensions=dims;
      renderFiles();
      updateResizePreview();
    });
  });
  toast(files.length+' gambar siap diproses.');
}
function renderFiles(){
  var el=$('filelist'); el.innerHTML='';
  updateDirectionLabels();
  updateResizePreview();
  if(!files.length) return;
  files.forEach(function(x){
    var d=document.createElement('div');
    d.innerHTML='<span>'+escapeHtml(x.name)+'</span><em>'+formatBytes(x.size)+'</em>';
    el.appendChild(d);
  });
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function loadMaxFiles(){
  var xhr=new XMLHttpRequest();
  xhr.open('GET','/api/config',true);
  xhr.addEventListener('load',function(){
    if(xhr.status<200||xhr.status>=300) return;
    try{
      var cfg=JSON.parse(xhr.responseText);
      if(cfg&&cfg.files&&Number(cfg.files.max)>0) maxFiles=Number(cfg.files.max);
    }catch(e){}
  });
  xhr.send();
}

var selectViews=[];
function closeAllSelects(){ selectViews.forEach(function(v){ v.wrap.classList.remove('open'); v.btn.setAttribute('aria-expanded','false'); }); }
function refreshSelect(el){ var v=selectViews.filter(function(x){return x.el===el;})[0]; if(v) v.render(); }
function enhanceSelect(el){
  var wrap=document.createElement('div'); wrap.className='ss-select';
  el.parentNode.insertBefore(wrap,el); wrap.appendChild(el); el.classList.add('ss-native');
  var btn=document.createElement('button'); btn.type='button'; btn.className='ss-select-value'; btn.setAttribute('aria-haspopup','listbox'); btn.setAttribute('aria-expanded','false');
  var menu=document.createElement('div'); menu.className='ss-select-menu'; menu.setAttribute('role','listbox');
  wrap.appendChild(btn); wrap.appendChild(menu);
  var view={el:el,wrap:wrap,btn:btn,menu:menu};
  selectViews.push(view);
  function close(){ wrap.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
  function render(){
    var label='';
    Array.prototype.forEach.call(el.options,function(o){ if(o.value===el.value) label=o.textContent; });
    btn.textContent = label || (el.selectedIndex>=0 ? el.options[el.selectedIndex].textContent : '');
    btn.setAttribute('aria-label',btn.textContent);
    menu.innerHTML='';
    Array.prototype.forEach.call(el.options,function(o){
      var b=document.createElement('button'); b.type='button'; b.className='ss-select-option'; b.setAttribute('role','option');
      b.setAttribute('aria-selected',String(o.value===el.value));
      if(o.value===el.value) b.className+=' selected';
      b.textContent=o.textContent;
      b.addEventListener('click',function(){
        el.value=o.value; render(); close();
        var ev=document.createEvent('HTMLEvents'); ev.initEvent('change',true,true); el.dispatchEvent(ev);
      });
      menu.appendChild(b);
    });
  }
  view.render=render;
  btn.addEventListener('click',function(e){
    e.stopPropagation(); var willOpen=!wrap.classList.contains('open'); closeAllSelects();
    if(willOpen){ wrap.classList.add('open'); btn.setAttribute('aria-expanded','true'); render(); }
  });
  el.addEventListener('change',render);
  render();
}
function enhanceSelects(){ ['direction','gridMode','outputType','enforce','detector','resizeMethod','profileSelect'].forEach(function(id){
 var el=$(id); if(el && !el.classList.contains('ss-native')) enhanceSelect(el); }); }
document.addEventListener('click',closeAllSelects);
document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeAllSelects(); });

function renderProfiles(){
  var s=$('profileSelect'); s.innerHTML='';
  store.profiles.forEach(function(p,i){
    var o=document.createElement('option'); o.value=i; o.textContent=p.profile_name; s.appendChild(o);
  });
  s.value=current;
  $('profileName').value=cur().profile_name;
  refreshSelect(s);
}
$('profileSelect').addEventListener('change',function(){
  saveSettingsToProfile();
  current=+$('profileSelect').value; store.current=current; saveStore();
  writeSettings(cur()); $('profileName').value=cur().profile_name;
  toast('Profil: '+cur().profile_name);
});
$('profileName').addEventListener('change',function(){ cur().profile_name=this.value||'Profile'; store.current=current; saveStore(); renderProfiles(); });
$('profileName').addEventListener('input',function(){ cur().profile_name=this.value||'Profile'; store.current=current; saveStore(); var s=$('profileSelect'), o=s.options[current]; if(o)o.textContent=cur().profile_name; refreshSelect(s); });
$('addProfile').addEventListener('click',function(){
  saveSettingsToProfile();
  var p=Object.assign({},defaultSettings,{profile_name:'Settings Profile '+(store.profiles.length+1)});
  store.profiles.push(p);
  current=store.profiles.length-1; store.current=current; saveStore();
  renderProfiles(); writeSettings(cur()); toast('Profil ditambahkan.');
});
$('delProfile').addEventListener('click',function(){
  if(store.profiles.length<=1){ toast('Profil terakhir tidak bisa dihapus.'); return; }
  store.profiles.splice(current,1); current=0; store.current=current; saveStore();
  renderProfiles(); writeSettings(cur()); toast('Profil dihapus.');
});
function saveSettingsToProfile(){ Object.assign(cur(),readSettings()); store.current=current; saveStore(); }
['direction','gridMode','outputType','quality','height','imageCount','enforce','customWidth','detector','sensitivity','scanStep','ignoreMargin','resizeWidth','resizeHeight','resizeMethod','zipName','sliceStart']
.forEach(function(id){
  $(id).addEventListener('change',function(){ syncConditional(); saveSettingsToProfile(); });
});
['imageCount','resizeWidth','resizeHeight'].forEach(function(id){
  if($(id)) $(id).addEventListener('input',function(){ updateGridModeFields(); updateResizePreview(); });
});
if($('icoSizes')) Array.prototype.forEach.call($('icoSizes').querySelectorAll('input[type=checkbox]'),function(c){
  c.addEventListener('change',function(){ updateResizePreview(); saveSettingsToProfile(); });
});
if($('zipName')) $('zipName').addEventListener('input',updateZipNamePreview);
if($('sliceStart')) $('sliceStart').addEventListener('input',updateSliceStartPreview);

$('start').addEventListener('click',function(){ if(!busy) run(); });

function formDataFor(s){
  var fd=new FormData();
  files.forEach(function(f){
    if(f.relativePath && f.relativePath!==f.name) fd.append('file:'+encodeURIComponent(f.relativePath),f.file,f.name);
    else fd.append('files',f.file,f.name);
  });
  fd.append('direction',s.direction||'vertical');
  fd.append('grid_mode',s.grid_mode||'custom');
  fd.append('image_count',String(s.image_count||4));
  fd.append('output_type',s.output_type);
  fd.append('lossy_quality',String(s.lossy_quality));
  fd.append('split_height',String(s.split_height));
  fd.append('enforce_type',String(s.enforce_type));
  fd.append('enforce_width',String(s.enforce_width));
  fd.append('detector_type',String(s.detector_type));
  fd.append('senstivity',String(s.senstivity));
  fd.append('scan_step',String(s.scan_step));
  fd.append('ignorable_pixels',String(s.ignorable_pixels));
  fd.append('resize_width',String(s.resize_width));
  fd.append('resize_height',String(s.resize_height));
  fd.append('resize_method',s.resize_method);
  fd.append('ico_sizes',JSON.stringify(s.ico_sizes||[]));
  fd.append('zip_name',s.zip_name||defaultSettings.zip_name);
  fd.append('slice_start',s.slice_start||defaultSettings.slice_start);
  fd.append('last_browse_location',s.last_browse_location||'');

  return fd;
}
function blobText(blob){
  if(blob && typeof blob.text==='function') return blob.text();
  return Promise.resolve(String(blob||''));
}
function errorMessage(text){
  try{ var o=JSON.parse(text); return o.error||text; }catch(e){ return text||'Permintaan gagal.'; }
}
function downloadUrl(url,name){
  var a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
}
function closeZipModal(){
  var modal=$('zipModal');
  if(!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden','true');
}
function openZipModal(meta,name){
  var modal=$('zipModal');
  if(!modal) return;
  if($('zipModalName')) $('zipModalName').textContent=name||currentZipName;
  if($('zipModalMeta')) $('zipModalMeta').textContent=meta||'Arsip potongan gambar';
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  if($('zipModalDownload')) $('zipModalDownload').focus();
}
function downloadZip(){
  if(zipUrl) downloadUrl(zipUrl,currentZipName);
}
function decodeZipName(buffer,offset,length){
  if(typeof TextDecoder!=='undefined') return new TextDecoder('utf-8').decode(new Uint8Array(buffer,offset,length));
  var out='';
  for(var i=0;i<length;i++) out+=String.fromCharCode(new DataView(buffer).getUint8(offset+i));
  return out;
}
function parseZipEntries(buffer){
  var view=new DataView(buffer), entries=[], offset=0;
  while(offset+30<=buffer.byteLength){
    if(view.getUint32(offset,true)!==0x04034b50) break;
    var compression=view.getUint16(offset+8,true);
    var size=view.getUint32(offset+18,true);
    var nameLength=view.getUint16(offset+26,true);
    var extraLength=view.getUint16(offset+28,true);
    var start=offset+30+nameLength+extraLength;
    if(start+size>buffer.byteLength) break;
    if(compression===0){
      entries.push({name:decodeZipName(buffer,offset+30,nameLength),start:start,size:size});
    }
    offset=start+size;
  }
  return entries;
}
function zipEntryBlob(entry){
  return zipBlob.slice(entry.start,entry.start+entry.size);
}
function downloadEntry(entry){
  if(!zipBlob) return;
  var url=URL.createObjectURL(zipEntryBlob(entry));
  var name=entry.name.replace(/\\/g,'/').split('/').pop()||'gambar';
  downloadUrl(url,name);
  setTimeout(function(){ URL.revokeObjectURL(url); },10000);
}
function clearResults(){
  resultToken++;
  if(zipUrl){ URL.revokeObjectURL(zipUrl); zipUrl=null; }
  previewUrls.forEach(function(url){ URL.revokeObjectURL(url); });
  previewUrls=[];
  zipBlob=null;
  zipEntries=[];
  closeZipModal();
  $('strip').innerHTML='';
  $('preview').classList.remove('show');
}
function renderResults(blob,name){
  clearResults();
  var token=resultToken;
  zipBlob=blob;
  zipUrl=URL.createObjectURL(blob);
  currentZipName=name||'SmartStitch.zip';
  var strip=$('strip');
  var card=document.createElement('div'); card.className='ss-shot'; card.title='Unduh '+currentZipName;
  var icon=document.createElement('div');
  icon.textContent='ZIP';
  icon.style.cssText='height:112px;display:flex;align-items:center;justify-content:center;background:#eef2ff;color:#4f46e5;border-radius:9px;font:700 22px/1 Inter,ui-sans-serif,sans-serif;letter-spacing:.08em';
  var cap=document.createElement('div'); cap.textContent=currentZipName;
  card.appendChild(icon); card.appendChild(cap);
  card.addEventListener('click',downloadZip);
  strip.appendChild(card);
  if($('previewTitle')) $('previewTitle').textContent='Arsip dan berkas siap diunduh';
  $('preview').classList.add('show');
  if(!blob.arrayBuffer) return;
  blob.arrayBuffer().then(function(buffer){
    if(token!==resultToken) return;
    zipEntries=parseZipEntries(buffer);
    renderEntryCards();
  }).catch(function(){});
}
function renderEntryCards(){
  var strip=$('strip');
  zipEntries.forEach(function(entry,index){
    var name=entry.name.replace(/\\/g,'/').split('/').pop()||'gambar';
    var card=document.createElement('div'); card.className='ss-shot'; card.title='Unduh '+name;
    if(index<12 && /\.(png|jpe?g|webp|bmp|gif|ico)$/i.test(name)){
      var url=URL.createObjectURL(zipEntryBlob(entry));
      previewUrls.push(url);
      var img=document.createElement('img'); img.src=url; img.alt=''; card.appendChild(img);
    }else{
      var badge=document.createElement('div');
      var ext=(name.match(/\.[^.]+$/)||[''])[0].replace('.','').toUpperCase()||'FILE';
      badge.textContent=ext;
      badge.style.cssText='height:112px;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#475569;border-radius:9px;font:700 18px/1 Inter,ui-sans-serif,sans-serif;letter-spacing:.08em';
      card.appendChild(badge);
    }
    var cap=document.createElement('div'); cap.textContent=name;
    card.appendChild(cap);
    card.addEventListener('click',function(){ downloadEntry(entry); });
    strip.appendChild(card);
  });
}

if($('zipModalClose')) $('zipModalClose').addEventListener('click',closeZipModal);
if($('zipModalBackdrop')) $('zipModalBackdrop').addEventListener('click',closeZipModal);
if($('zipModalDownload')) $('zipModalDownload').addEventListener('click',downloadZip);
document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeZipModal(); });


function requestError(stage, message){
  var err=new Error(message);
  err.stage=stage;
  return err;
}
function responseHeaders(xhr){
  var names=['X-Job-Id','X-Processed-Slices','X-Grid-Mode','X-Grid-Shape','X-Input-Dirs','X-Process-Ms','X-R2-Deleted','X-R2-Cleanup-Failed','X-Zip-Name'];
  var out={};
  names.forEach(function(name){ out[name.toLowerCase()]=xhr.getResponseHeader(name)||''; });
  return out;
}
function putToR2(upload, fileObj, onProgress){
  return new Promise(function(resolve,reject){
    var xhr=new XMLHttpRequest();
    xhr.open(upload.method||'PUT',upload.url,true);
    xhr.upload.addEventListener('progress',onProgress);
    xhr.addEventListener('load',function(){
      if(xhr.status>=200&&xhr.status<300) resolve();
      else reject(requestError('put','Unggah berkas gagal ('+xhr.status+') untuk '+upload.name+'.'));
    });
    xhr.addEventListener('error',function(){ reject(requestError('put','Unggah berkas gagal untuk '+upload.name+'.')); });
    xhr.send(fileObj.file);
  });
}
function runPresigned(s){
  return fetch('/api/presign',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({files:files.map(function(f){ return {name:f.name,relativePath:f.relativePath,size:f.size}; })})
  }).then(function(r){
    return r.text().then(function(text){
      if(!r.ok) throw requestError('presign',errorMessage(text));
      try{ return JSON.parse(text); }catch(e){ throw requestError('presign','Respons presign tidak valid.'); }
    });
  }).then(function(data){
    if(!data||!data.jobId||!Array.isArray(data.uploads)||!data.uploads.length){
      throw requestError('presign','Respons presign tidak valid.');
    }
    var totalBytes=data.uploads.reduce(function(sum,u){ return sum+(u.size||0); },0)||1;
    var uploadedBytes=0;
    var chain=Promise.resolve();

    data.uploads.forEach(function(upload,index){
      chain=chain.then(function(){
        var fileObj=files[index];
        if(!fileObj) throw requestError('presign','File tidak ditemukan: '+upload.name+'.');
        return putToR2(upload,fileObj,function(e){
          if(!e.lengthComputable) return;
          var p=Math.round((uploadedBytes+e.loaded)/totalBytes*35);
          setStatus('Mengunggah berkas… '+p+'%',p);
        }).catch(function(err){
          err.jobId=data.jobId;
          throw err;
        }).then(function(){ uploadedBytes+=upload.size||fileObj.size||0; });
      });
    });

    return chain.then(function(){
      setStatus('Memproses gambar…',38);
      log('Berkas berhasil diunggah. Memproses gambar…');
      return new Promise(function(resolve,reject){
        var xhr=new XMLHttpRequest();
        xhr.open('POST','/api/process',true);
        xhr.responseType='blob';
        xhr.setRequestHeader('Content-Type','application/json');
        xhr.addEventListener('load',function(){
          if(xhr.status>=200&&xhr.status<300){
            resolve({blob:xhr.response,headers:responseHeaders(xhr)});
          }else{
            blobText(xhr.response).then(function(text){ reject(requestError('process',errorMessage(text))); });
          }
        });
        xhr.addEventListener('error',function(){ reject(requestError('process','Server tidak merespons.')); });
        xhr.send(JSON.stringify({
          jobId:data.jobId,
          inputs:data.uploads.map(function(u){ return {key:u.key,name:u.name,relativePath:u.relativePath,size:u.size}; }),
          settings:s
        }));
      });
    });
  });
}
function runMultipart(s){
  setStatus('Mengunggah '+files.length+' gambar…',2);
  log('Mengirim berkas melalui jalur standar.');
  var fake=2;
  var timer=setInterval(function(){ if(fake<88){ fake+=1; $('bar').style.width=fake+'%'; } },420);

  return new Promise(function(resolve,reject){
    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/process',true);
    xhr.responseType='blob';
    xhr.upload.addEventListener('progress',function(e){
      if(e.lengthComputable){
        var p=Math.round(e.loaded/e.total*35);
        setStatus('Mengunggah berkas… '+p+'%',p);
      }
    });
    xhr.upload.addEventListener('load',function(){
      setStatus('Memproses gambar…',38);
      log('Unggah selesai. Menyusun potongan dan arsip ZIP.');
    });
    xhr.addEventListener('load',function(){
      clearInterval(timer);
      if(xhr.status>=200&&xhr.status<300) resolve({blob:xhr.response,headers:responseHeaders(xhr)});
      else blobText(xhr.response).then(function(text){ reject(requestError('multipart',errorMessage(text))); });
    });
    xhr.addEventListener('error',function(){
      clearInterval(timer);
      reject(requestError('multipart','Jaringan / server tidak merespons.'));
    });
    xhr.addEventListener('abort',function(){
      clearInterval(timer);
      reject(requestError('multipart','Upload dibatalkan.'));
    });
    xhr.send(formDataFor(s));
  });
}
function finishResult(result, t0, s){
  var h=result.headers;
  renderResults(result.blob,h['x-zip-name']);
  var slices=h['x-processed-slices']||'?';
  var failed=h['x-r2-cleanup-failed']||'0';
  var grid=h['x-grid-shape']||'-';
  var resizeMode=s.grid_mode==='resize';
  var label=resizeMode?'gambar':'potongan';
  var detail=resizeMode ? 'ukuran: '+grid : 'tata letak: '+grid;
  var size=result.blob&&result.blob.size?formatBytes(result.blob.size):'-';
  var dt=(performance.now()-t0)/1000;
  openZipModal(label+': '+slices+' · '+detail+' · '+size,currentZipName);
  log('Selesai dalam '+dt.toFixed(3)+' detik.');
  log('Hasil: '+slices+' '+label+' · '+detail+' · ukuran '+size+(failed!=='0'?' · '+failed+' berkas sementara tersisa.':'.'));
  if(failed!=='0') toast('Proses selesai, tetapi sebagian berkas sementara tidak dapat dibersihkan.');
  else toast('Proses selesai. '+(resizeMode?'Gambar hasil dapat diunduh satu per satu.':'Arsip siap diunduh.'));
  setStatus('Proses selesai dalam '+dt.toFixed(3)+' detik.',100);
}
function cleanupUpload(jobId){
  if(!jobId) return Promise.resolve();
  return fetch('/api/upload-cleanup',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jobId:jobId})
  }).catch(function(){ return null; });
}
function handleRunError(err){
  var msg=err&&err.message?err.message:'Permintaan gagal.';
  log('Proses gagal: '+msg);
  setStatus('Proses gagal — '+msg,0);
  toast(msg);
}
function run(){
  if(!files.length){ toast('Pilih gambar terlebih dahulu.'); return; }
  var s=readSettings();
  if(s.output_type==='.ico' && s.grid_mode==='resize' && (s.resize_width>256||s.resize_height>256)){
    toast('ICO hanya mendukung sisi maksimal 256 px. Kurangi ukuran resize.');
    return;
  }
  busy=true; $('start').disabled=true; $('log').textContent=''; $('log').classList.add('show');
  clearResults();
  var t0=performance.now();
  Object.assign(cur(),s); saveStore();

  setStatus('Menyiapkan berkas…',2);
  log('Menyiapkan '+files.length+' gambar untuk '+(s.grid_mode==='resize'?'di-resize satu per satu.':'diproses.'));

  runPresigned(s).then(function(result){
    finishResult(result,t0,s);
    busy=false; $('start').disabled=false;
  }).catch(function(err){
    if(err&&(err.stage==='presign'||err.stage==='put')){
      log('Unggahan langsung tidak tersedia. Menggunakan jalur standar.');
      return cleanupUpload(err.jobId).then(function(){
        return runMultipart(s);
      }).then(function(result){
        finishResult(result,t0,s);
        busy=false; $('start').disabled=false;
      }).catch(function(fallbackErr){
        handleRunError(fallbackErr);
        busy=false; $('start').disabled=false;
      });
    }
    handleRunError(err);
    busy=false; $('start').disabled=false;
  });
}

loadMaxFiles();
writeSettings(cur());
renderProfiles();
enhanceSelects();
syncConditional();
setStatus(
files.length ? 'Siap memproses '+files.length+' gambar.' : 'Siap memproses gambar.',0);
})();
