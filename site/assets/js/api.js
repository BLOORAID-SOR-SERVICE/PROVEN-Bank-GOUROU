/* PROVEN Bank — API helpers */
(function(){
'use strict';
window.provenAPI={
  get:function(url,cb){
    var x=new XMLHttpRequest();
    x.open('GET',url,true);
    x.onload=function(){try{cb(null,JSON.parse(x.responseText));}catch(e){cb(e);}};
    x.onerror=function(){cb(new Error('Network error'));};
    x.send();
  },
  post:function(url,data,cb){
    var x=new XMLHttpRequest();
    x.open('POST',url,true);
    x.setRequestHeader('Content-Type','application/json');
    x.onload=function(){try{cb(null,JSON.parse(x.responseText));}catch(e){cb(e);}};
    x.onerror=function(){cb(new Error('Network error'));};
    x.send(JSON.stringify(data));
  }
};
})();
