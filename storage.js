const fs = require('node:fs');
const path = require('node:path');

// One Node process. Synchronous handlers serialize each read/modify/write commit.
function createStore(directory) {
  const file = path.join(directory, 'city-sim.json'), backup = file + '.bak';
  const unavailable = () => Object.assign(new Error('City storage is unavailable. Your changes have not been committed. Ask the organizer to check the saved data and backup.'), { status: 503 });
  function parse(text) {
    const db = JSON.parse(text);
    if (!db || !Array.isArray(db.teams) || !Array.isArray(db.sessions) || (db.codes !== undefined && !Array.isArray(db.codes))) throw unavailable();
    return {...db, codes:db.codes || [], audit:Array.isArray(db.audit)?db.audit:[]};
  }
  function read() {
    try {
      if (!fs.existsSync(file)) {
        if (fs.existsSync(backup)) throw unavailable();
        return {teams:[],sessions:[],codes:[],audit:[]};
      }
      return parse(fs.readFileSync(file, 'utf8'));
    } catch { throw unavailable(); }
  }
  function atomic(target, text) {
    const temporary=target+'.tmp', fd=fs.openSync(temporary,'w',0o600);
    try {fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.renameSync(temporary,target);
  }
  function write(db) {
    try {
      fs.mkdirSync(directory,{recursive:true});
      const serialized=JSON.stringify(db,null,2);parse(serialized);
      if(fs.existsSync(file)) {
        const old=fs.readFileSync(file,'utf8');parse(old);
        const original=path.join(directory,'before-v2.json.bak');
        if(!fs.existsSync(original))atomic(original,old);
        atomic(backup,old);
      }
      atomic(file,serialized);
    } catch {throw unavailable();}
  }
  return {read,write,file,backup};
}
module.exports={createStore};

