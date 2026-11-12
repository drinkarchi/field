/* Mock supabase-js v2 (subset) — semua operasi diteruskan ke window.__db (Node) agar beberapa tab berbagi DB */
(function(){
  function Q(table){this.t=table;this.f=[];this.o=[];this.r=null;this.lim=null;this.single=false;this.op='select';this.payload=null}
  Q.prototype.select=function(){return this};
  Q.prototype.eq=function(c,v){this.f.push(['eq',c,v]);return this};
  Q.prototype.gt=function(c,v){this.f.push(['gt',c,v]);return this};
  Q.prototype.order=function(c){this.o.push(c);return this};
  Q.prototype.range=function(a,b){this.r=[a,b];return this};
  Q.prototype.limit=function(n){this.lim=n;return this};
  Q.prototype.maybeSingle=function(){this.single=true;return this};
  Q.prototype.delete=function(){this.op='delete';return this};
  Q.prototype.upsert=function(rows){this.op='upsert';this.payload=rows;return this};
  Q.prototype.then=function(res,rej){var me=this;return window.__db('query',{t:me.t,f:me.f,o:me.o,r:me.r,lim:me.lim,single:me.single,op:me.op,payload:me.payload,tok:localStorage.getItem('mock-tok')}).then(function(x){return JSON.parse(x)}).then(res,rej)};
  var listeners=[];window.__rt=function(row){listeners.forEach(function(f){f({new:row})})};
  window.supabase={createClient:function(){return {
    auth:{getSession:function(){var t=localStorage.getItem('mock-tok');return Promise.resolve({data:{session:t?{user:{id:t}}:null}})},
      signInWithPassword:function(c){return window.__db('login',c).then(function(x){x=JSON.parse(x);if(x.error)return {error:x.error};localStorage.setItem('mock-tok',x.uid);return {data:{session:{user:{id:x.uid}}}}})},
      onAuthStateChange:function(f){window.__authcb=f;return {data:{subscription:{unsubscribe:function(){}}}}},
      refreshSession:function(){var t=localStorage.getItem('mock-tok');return Promise.resolve({data:{session:t?{user:{id:t}}:null}})},
      signOut:function(){if(window.__authcb)setTimeout(function(){window.__authcb('SIGNED_OUT',null)},0);localStorage.removeItem('mock-tok');return Promise.resolve({})},
      updateUser:function(){return Promise.resolve({data:{}})},
      setSession:function(s){localStorage.setItem('mock-tok',s.access_token);return Promise.resolve({data:{session:{user:{id:s.access_token}}}})}},
    from:function(t){return new Q(t)},
    rpc:function(n){return Promise.resolve({data:new Date(Date.now()+ (window.__skew||0)).toISOString()})},
    channel:function(){var ch={on:function(a,b,f){listeners.push(f);return ch},subscribe:function(){return ch}};return ch},
    storage:{from:function(){return {upload:function(p,b){return window.__db('upload',{p:p,size:b.size,tok:localStorage.getItem('mock-tok')}).then(function(x){return JSON.parse(x)})},
      createSignedUrls:function(ps){return Promise.resolve({data:ps.map(function(p){return {path:p,signedUrl:'data:image/gif;base64,R0lGODlhAQABAAAAACw='}})})}}}},
    functions:{invoke:function(n,o){return window.__db('fn',{n:n,body:o.body,tok:localStorage.getItem('mock-tok')}).then(function(x){return JSON.parse(x)})}}
  }}};
})();
