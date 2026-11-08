(() => {
  function initialize({container,api}) {
    const make=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
    const panel=make('section','privacy-tool');
    const heading=make('div','privacy-heading');
    const title=make('div');title.append(make('h2','','Privacidade da navegação'),make('p','','Revise o histórico, os cookies e o cache dos seus navegadores.'));
    const refreshButton=make('button','mini','Atualizar');refreshButton.type='button';refreshButton.id='privacyRefresh';heading.append(title,refreshButton);
    const intro=make('p','view-note','A exclusão é confirmada no próprio navegador. Lá você escolhe o perfil, o período e os dados a remover.');
    const label=make('label','privacy-label','Navegador');label.htmlFor='privacyBrowser';
    const select=make('select');select.id='privacyBrowser';
    const selected=make('div','privacy-selected');selected.id='privacySelected';
    const guide=make('p','view-note');guide.id='privacyGuide';
    const openButton=make('button','mini solid','Abrir opções de limpeza');openButton.type='button';openButton.id='privacyOpen';
    const card=make('section','settings-card card');card.append(label,select,selected,guide,openButton);
    const info=make('section','settings-card card');info.append(make('h3','','O que revisar'));
    for(const [name,description] of [
      ['Histórico e buscas','Páginas visitadas e pesquisas registradas pelo navegador.'],
      ['Cookies e dados de sites','Podem manter contas conectadas. Ao removê-los, alguns sites pedirão login novamente.'],
      ['Cache','Cópias temporárias de páginas e imagens.'],
      ['Senhas e favoritos','Confira as opções antes de confirmar para preservar o que deseja manter.']
    ]) {const row=make('div','privacy-info-row');row.append(make('strong','',name),make('p','',description));info.append(row);}
    const note=make('p','view-note','Limpar a lista de downloads não apaga os arquivos baixados. A sincronização pode afetar outros dispositivos. Registros mantidos por sites e contas on-line precisam ser revisados nesses serviços.');
    const status=make('p','privacy-status');status.id='privacyStatus';status.setAttribute('role','status');status.hidden=true;
    panel.append(heading,intro,card,status,info,note);container.replaceChildren(panel);
    let browsers=[],generation=0,busy=false,active=false;
    function message(text){status.textContent=text;status.hidden=!text;}
    function render(){
      const item=browsers.find(item=>item.id===select.value);
      select.disabled=busy||!browsers.length;openButton.disabled=busy||!item;refreshButton.disabled=busy;
      guide.textContent=item?.instructions||'Atualize a lista para localizar os navegadores instalados.';
      openButton.textContent=item?.actionLabel||'Abrir opções de limpeza';selected.replaceChildren();
      if(item){
        if(typeof item.icon==='string'&&item.icon.length<=262144&&/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.icon)){
          const image=make('img');image.alt='';image.width=24;image.height=24;image.src=item.icon;image.addEventListener('error',()=>image.remove(),{once:true});selected.append(image);
        }
        selected.append(make('strong','',item.name));
      }
    }
    async function refresh(){
      active=true;if(busy)return;const seq=++generation;busy=true;render();message('Localizando navegadores…');
      try{
        const result=await api.getPrivacyBrowsers();if(seq!==generation||!active)return;
        if(!result?.ok||!Array.isArray(result.browsers))throw Error(result?.error||'Não foi possível listar os navegadores.');
        const previous=select.value;browsers=result.browsers.filter(item=>typeof item?.id==='string'&&typeof item.name==='string');
        select.replaceChildren(...browsers.map(item=>{const option=make('option','',item.name);option.value=item.id;return option;}));
        if(browsers.some(item=>item.id===previous))select.value=previous;
        message(browsers.length?'':'Nenhum navegador compatível foi localizado. Verifique se ele está na pasta Aplicativos.');
      }catch(error){if(seq===generation){browsers=[];select.replaceChildren();message(error.message||'Não foi possível listar os navegadores.');}}
      finally{if(seq===generation){busy=false;render();}}
    }
    async function open(){
      if(busy||!active||!browsers.some(item=>item.id===select.value))return;
      const seq=generation;busy=true;render();message('Abrindo o navegador…');
      try{
        const result=await api.openPrivacyBrowser(select.value);if(seq!==generation||!active)return;
        if(!result?.ok)throw Error(result?.error||'Não foi possível abrir o navegador.');
        message(result.message||'Navegador aberto. Revise as opções e confirme a exclusão nele.');
      }catch(error){if(seq===generation)message(error.message||'Não foi possível abrir o navegador.');}
      finally{if(seq===generation){busy=false;render();}}
    }
    refreshButton.addEventListener('click',()=>void refresh());select.addEventListener('change',()=>{message('');render();});openButton.addEventListener('click',()=>void open());
    render();return{refresh,deactivate(){active=false;generation++;busy=false;render();}};
  }
  window.CalangoPrivacy={initialize};
})();
