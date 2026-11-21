(function(){
"use strict";

var SS_ROOT = document.getElementById('ss-root') || document;
var $ = function(id){ return SS_ROOT.querySelector('#'+id) || document.getElementById(id); };
var files = [];
var zipUrl = null;
var busy = false;

var KEY = 'smartstitch_web_profiles_v1';
var defaultSettings = {
  profile_name:'Settings Profile 1',
  direction:'vertical', grid_mode:'custom', image_count:4,
  split_height:5000, output_type:'.tga', lossy_quality:100,
  detector_type:1, senstivity:90, ignorable_pixels:5, scan_step:5,
  enforce_type:2, enforce_width:720, run_postprocess:false,
  postprocess_app:'', postprocess_args:'', last_browse_location:''
};
var defaultProfiles = [Object.assign({},defaultSettings)];
var store = loadStore();
var current = Math.min(store.current||0, store.profiles.length-1);

function normalizeProfile(p){
  var s = Object.assign({},defaultSettings,p&&p.settings?p.settings:null,p);
  s.profile_name = s.profile_name || s.name || defaultSettings.profile_name;
  s.direction = s.direction === 'horizontal' ? 'horizontal' : 'vertical';
  s.grid_mode = s.grid_mode === 'count' ? 'count' : 'custom';
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
  s.run_postprocess = !!s.run_postprocess;
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
    run_postprocess:$('runPost').checked,
    postprocess_app:$('postprocessApp')?$('postprocessApp').value:'',
    postprocess_args:$('postprocessArgs')?$('postprocessArgs').value:''
  };
}
function writeSettings(s){
  s = s || defaultSettings;
  $('direction').value = s.direction === 'horizontal' ? 'horizontal' : 'vertical';
  $('gridMode').value = s.grid_mode === 'count' ? 'count' : 'custom';
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
  $('runPost').checked = !!s.run_postprocess;
  if($('postprocessApp')) $('postprocessApp').value = s.postprocess_app||'';
  if($('postprocessArgs')) $('postprocessArgs').value = s.postprocess_args||'';
  syncConditional();
  updateFmtHint();
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
function updateFmtHint(){
  var f=$('outputType').value;
  var lossy = (f==='.jpg'||f==='.jpeg'||f==='.webp'||f==='.tiff');
  $('qualityWrap').style.display = lossy ? 'flex' : 'none';
  $('fmtHint').textContent = lossy ? 'Quality diterapkan server saat encode.' : 'Format ini tidak memakai quality.';
}
function updateDirectionLabels(){
  var horizontal = $('direction').value === 'horizontal';
  if($('directionHint')){
    var countMode = $('gridMode') && $('gridMode').value === 'count';
    $('directionHint').textContent = countMode
      ? (horizontal
        ? 'Image Count: gambar digabung kiri/kanan; grid lebih banyak kolom.'
        : 'Image Count: gambar digabung atas/bawah; grid lebih banyak baris.')
      : (horizontal
        ? (files.length === 2
          ? 'Mode horizontal: 2 gambar — gambar ke-2 otomatis mengikuti ukuran gambar pertama.'
          : 'Mode horizontal meresizing tinggi dan memotong sepanjang lebar.')
        : 'Mode vertikal meresizing lebar dan memotong sepanjang tinggi.');
  }
  if($('heightLabel')) $('heightLabel').textContent = horizontal ? 'Rough Output Width' : 'Rough Output Height';
  if($('heightHint')) $('heightHint').textContent = horizontal
    ? 'Perkiraan lebar tiap potongan (split_height).'
    : 'Tinggi perkiraan tiap potongan (split_height).';
  if($('enforceLabel')) $('enforceLabel').textContent = horizontal ? 'Height Enforcement Type' : 'Width Enforcement Type';
  if($('customWidthLabel')) $('customWidthLabel').textContent = horizontal
    ? 'Manual Custom Height [pixel]'
    : 'Manual Custom Width [pixel]';
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
  var countMode=$('gridMode') && $('gridMode').value==='count';
  if($('customGridFields')) $('customGridFields').style.display=countMode?'none':'grid';
  if($('countGridFields')) $('countGridFields').style.display=countMode?'grid':'none';
  if($('gridShapePreview')){
    var direction=$('direction')&&$('direction').value==='horizontal'?'horizontal':'vertical';
    var shape=gridShapeFor($('imageCount')?$('imageCount').value:4,direction);
    $('gridShapePreview').textContent = (shape.exact
      ? shape.count+' gambar → '+shape.rows+'×'+shape.cols+' (baris×kolom)'
      : shape.count+' gambar → '+shape.rows+' baris, kolom per baris: '+shape.columnsPerRow.join(', '))+' · '+direction;
  }
}
function syncConditional(){
  updateDirectionLabels();
  updateGridModeFields();
  $('customWrap').style.display = ($('enforce').value==='2')?'flex':'none';
  $('smartOpts').style.display = ($('detector').value==='1')?'grid':'none';
  var post = $('runPost').checked;
  if($('postAppWrap')) $('postAppWrap').style.display = post?'block':'none';
  if($('postArgsWrap')) $('postArgsWrap').style.display = post?'block':'none';
}

Array.prototype.forEach.call(document.querySelectorAll('.ss-tab'),function(btn){
  btn.addEventListener('click',function(){
    Array.prototype.forEach.call(document.querySelectorAll('.ss-tab'),function(b){b.classList.remove('active');});
    Array.prototype.forEach.call(document.querySelectorAll('.ss-panel'),function(p){p.classList.remove('active');});
    btn.classList.add('active');
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
  if(!ok.length){ toast('Tidak ada gambar yang dikenali.'); return; }
  ok=ok.map(function(f){
    return {file:f, name:f.name, size:f.size, relativePath:f.webkitRelativePath||f.name};
  });
  files=files.concat(ok);
  files.sort(function(a,b){ return naturalCompare(a.relativePath,b.relativePath); });
  renderFiles();
  toast(files.length+' gambar siap diunggah.');
}
function renderFiles(){
  var el=$('filelist'); el.innerHTML='';
  updateDirectionLabels();
  if(!files.length) return;
  files.forEach(function(x){
    var d=document.createElement('div');
    d.innerHTML='<span>'+escapeHtml(x.name)+'</span><em>'+formatBytes(x.size)+'</em>';
    el.appendChild(d);
  });
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

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
function enhanceSelects(){ ['direction','gridMode','outputType','enforce','detector','profileSelect','postprocessApp'].forEach(function(id){ var el=$(id); if(el && !el.classList.contains('ss-native')) enhanceSelect(el); }); }
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
['direction','gridMode','outputType','quality','height','imageCount','enforce','customWidth','detector','sensitivity','scanStep','ignoreMargin','runPost','postprocessApp','postprocessArgs'].forEach(function(id){
  $(id).addEventListener('change',function(){ syncConditional(); updateFmtHint(); saveSettingsToProfile(); });
});
if($('imageCount')) $('imageCount').addEventListener('input',function(){ updateGridModeFields(); });

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
  fd.append('run_postprocess',s.run_postprocess?'true':'false');
  fd.append('postprocess_app',s.postprocess_app||'');
  fd.append('postprocess_args',s.postprocess_args||'');
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
function openZipModal(meta){
  var modal=$('zipModal');
  if(!modal) return;
  if($('zipModalMeta')) $('zipModalMeta').textContent=meta||'Arsip potongan gambar';
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  if($('zipModalDownload')) $('zipModalDownload').focus();
}
function downloadZip(){
  if(zipUrl) downloadUrl(zipUrl,'smartstitch_slices.zip');
}
function clearResults(){
  if(zipUrl){ URL.revokeObjectURL(zipUrl); zipUrl=null; }
  closeZipModal();
  $('strip').innerHTML='';
  $('preview').classList.remove('show');
}
function renderResults(blob){
  clearResults();
  zipUrl=URL.createObjectURL(blob);
  var strip=$('strip');
  var card=document.createElement('div'); card.className='ss-shot'; card.title='Unduh arsip ZIP';
  var icon=document.createElement('div');
  icon.textContent='ZIP';
  icon.style.cssText='height:112px;display:flex;align-items:center;justify-content:center;background:#eef2ff;color:#4f46e5;border-radius:9px;font:700 22px/1 Inter,ui-sans-serif,sans-serif;letter-spacing:.08em';
  var cap=document.createElement('div'); cap.textContent='smartstitch_slices.zip';
  card.appendChild(icon); card.appendChild(cap);
  card.addEventListener('click',downloadZip);
  strip.appendChild(card);
  $('preview').classList.add('show');
}

if($('zipModalClose')) $('zipModalClose').addEventListener('click',closeZipModal);
if($('zipModalBackdrop')) $('zipModalBackdrop').addEventListener('click',closeZipModal);
if($('zipModalDownload')) $('zipModalDownload').addEventListener('click',downloadZip);
document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeZipModal(); });

function loadPostprocessApps(){
  var sel=$('postprocessApp');
  if(!sel) return Promise.resolve();
  return fetch('/api/config').then(function(r){ return r.json(); }).then(function(cfg){
    var apps=(cfg&&cfg.postprocessApps)||[];
    sel.innerHTML='<option value="">-</option>';
    apps.forEach(function(name){
      var o=document.createElement('option'); o.value=name; o.textContent=name; sel.appendChild(o);
    });
    if(apps.indexOf(cur().postprocess_app)===-1) cur().postprocess_app='';
    sel.value=cur().postprocess_app||'';
    if($('postConfigHint')) $('postConfigHint').textContent=apps.length
      ? apps.length+' aplikasi diizinkan oleh server.'
      : 'Belum ada aplikasi diizinkan. Set POSTPROCESS_WHITELIST di server.';
    refreshSelect(sel);
    syncConditional();
  }).catch(function(){
    if($('postConfigHint')) $('postConfigHint').textContent='Gagal memuat daftar aplikasi post-process.';
  });
}

function requestError(stage, message){
  var err=new Error(message);
  err.stage=stage;
  return err;
}
function responseHeaders(xhr){
  var names=['X-Job-Id','X-Processed-Slices','X-Grid-Mode','X-Grid-Shape','X-Input-Dirs','X-Process-Ms','X-R2-Deleted','X-R2-Cleanup-Failed','X-Postprocess','X-Postprocess-Exit'];
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
      else reject(requestError('put','Upload R2 gagal ('+xhr.status+') untuk '+upload.name+'.'));
    });
    xhr.addEventListener('error',function(){ reject(requestError('put','Upload R2 gagal untuk '+upload.name+'.')); });
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
          setStatus('Upload langsung ke R2… '+p+'%',p);
        }).catch(function(err){
          err.jobId=data.jobId;
          throw err;
        }).then(function(){ uploadedBytes+=upload.size||fileObj.size||0; });
      });
    });

    return chain.then(function(){
      setStatus('Memproses di server — menyimpan sementara di Cloudflare R2…',38);
      log('Upload langsung ke R2 selesai. Memproses di server…');
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
  setStatus('Mengunggah '+files.length+' gambar ke server…',2);
  log('Fallback: mengirim gambar lewat multipart ke server.');
  var fake=2;
  var timer=setInterval(function(){ if(fake<88){ fake+=1; $('bar').style.width=fake+'%'; } },420);

  return new Promise(function(resolve,reject){
    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/process',true);
    xhr.responseType='blob';
    xhr.upload.addEventListener('progress',function(e){
      if(e.lengthComputable){
        var p=Math.round(e.loaded/e.total*35);
        setStatus('Mengunggah ke server… '+p+'%',p);
      }
    });
    xhr.upload.addEventListener('load',function(){
      setStatus('Memproses di server — menyimpan sementara di Cloudflare R2…',38);
      log('Upload selesai. Server memproses gambar dan menyimpan sementara di R2.');
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
function finishResult(result, s, t0){
  renderResults(result.blob);
  var h=result.headers;
  var slices=h['x-processed-slices']||'?';
  var deleted=h['x-r2-deleted']||'0';
  var failed=h['x-r2-cleanup-failed']||'0';
  var job=h['x-job-id']||'-';
  var grid=h['x-grid-shape']||'-';
  var size=result.blob&&result.blob.size?formatBytes(result.blob.size):'-';
  var dt=(performance.now()-t0)/1000;
  openZipModal('slice: '+slices+' · grid: '+grid+' · '+size);
  log('Selesai dalam '+dt.toFixed(3)+' detik.');
  log('Job: '+job+' · grid: '+grid+' · slice: '+slices+' · R2 dihapus: '+deleted+' · gagal: '+failed);
  if(failed!=='0') toast('Proses selesai, tetapi sebagian objek R2 gagal dihapus.');
  else toast('Selesai — objek R2 sementara sudah dihapus.');
  setStatus('Idle — Process completed in '+dt.toFixed(3)+' seconds',100);
  if(s.run_postprocess) downloadZip();
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
  log('ERROR: '+msg);
  setStatus('Idle — gagal: '+msg,0);
  toast(msg);
}
function run(){
  if(!files.length){ toast('Pilih gambar dulu.'); return; }
  busy=true; $('start').disabled=true; $('log').textContent=''; $('log').classList.add('show');
  clearResults();
  var t0=performance.now();
  var s=readSettings();
  Object.assign(cur(),s); saveStore();

  setStatus('Menyiapkan upload langsung ke R2…',2);
  log('Menyiapkan '+files.length+' upload langsung ke Cloudflare R2.');

  runPresigned(s).then(function(result){
    finishResult(result,s,t0);
    busy=false; $('start').disabled=false;
  }).catch(function(err){
    if(err&&(err.stage==='presign'||err.stage==='put')){
      log('Upload langsung gagal: '+err.message+' Fallback ke multipart.');
      return cleanupUpload(err.jobId).then(function(){
        return runMultipart(s);
      }).then(function(result){
        finishResult(result,s,t0);
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

writeSettings(cur());
renderProfiles();
enhanceSelects();
updateFmtHint();
syncConditional();
loadPostprocessApps();
setStatus('Idle — ' + files.length + ' gambar siap diproses.',0);
})();
