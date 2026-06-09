// ══ ÉTAT ══
let curForm=null,filtered=[...FORMS_DATA],sortCol='nom',sortDir=1;
let pageSize=10,curPage=1;
let builderFields=[],formColor='#3b82f6',formModules=['general'];
let layoutRows=[],declItems=[],curFieldIdx=null,bTab='gen';
let previewValues={},previewMode='sup';
let cfgOpen=false,cfgTab='G';
let saisieValues={},curSaisieFormId=null;

