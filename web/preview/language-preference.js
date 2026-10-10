const key='tevumi:language:v1';
export function readLanguagePreference(){
 try{return localStorage.getItem(key)==='zh-CN'?'zh-CN':'en';}catch{return 'en';}
}
export function saveLanguagePreference(language){
 if(!['en','zh-CN'].includes(language))return;
 try{localStorage.setItem(key,language);}catch{/* Language switching still works when storage is unavailable. */}
}
