# CalangoClean — especificação do projeto

> Nome do app: **CalangoClean** (C e C maiúsculos; é o nome de exibição). `productName` = CalangoClean (CalangoClean.app), título da janela, textos da UI, notificações e nome do `.dmg` usam esse nome. Os **identificadores continuam em minúsculas**: appId `com.sejacalango.calangoclean`, pasta de dados `~/Library/Application Support/calangoclean`, LaunchAgent `com.sejacalango.calangoclean.auto`. A pasta do projeto continua `limpa-mac`. Antes se chamava limpa-mac / Limpa Mac, depois calangoclean (ver Migração).

## Objetivo
App de barra de menu para macOS que mostra o espaço livre em disco e permite ao usuário **escolher** o que limpar. Baseado no script `limpar-mac.sh` (nesta pasta, apenas como referência — não chamar o bash; reimplementar a lógica em Node).

Fase 1: uso pessoal (Pablo e irmão), sem assinatura Apple.
Fase 2: distribuição pública no site sejacalango.com.br, com assinatura e notarização.

## Stack
- Electron + pacote `menubar` (app só na barra de menu, sem ícone no Dock)
- Node.js puro para a lógica (`fs/promises`, `child_process` só quando necessário: `df`, `pgrep`, `brew`, `npm`, `pip3`)
- UI: HTML + CSS + JS simples (sem framework) na janela do menubar
- Ícones das ferramentas: Phosphor Icons ou Lucide (SVG embutido, licença MIT). Por pedido do Pablo, Desempenho e Apps mostram também os ícones dos aplicativos instalados: leitura sob demanda do ícone declarado no bundle, conversão nativa para PNG em pasta temporária e fallback do macOS. Não redistribuir esses ícones como assets do CalangoClean.
- `electron-builder` para gerar `.dmg` universal (arm64 + x64)

## Arquitetura
```
src/
  main.js            # Electron + menubar, IPC
  photoDuplicates.js # fotos e arquivos idênticos: busca manual, comparação e envio à Lixeira
  duplicateFileTypes.js # tipos permitidos e validação de assinaturas; nunca executa arquivos
  photoWindow.js     # janela própria de revisão e IPC restrito ao seu renderer
  photosPreload.js   # API mínima da janela de fotos
  trashFinder.js     # listagem e esvaziamento nativos da Lixeira (Automação)
  preload.js         # contextBridge seguro
  config.js          # lê/grava config.json (gravação atômica)
  disk.js            # espaço livre do volume /System/Volumes/Data
  scheduler.js       # instala/remove o LaunchAgent
  cli.js             # modo headless: `--auto` (chamado pelo launchd)
  volumes.js         # discos externos em /Volumes: lista, ejeta e observa (somente leitura)
  volumeFolders.js   # gráfico por pastas dos discos externos, por clique e cancelável
  network.js         # rede: tipo de conexão, IP e teste de velocidade (só sob demanda)
  performance.js     # processos e LaunchAgents do usuário; leitura e ações só sob demanda
  bluetooth.js       # aparelhos Bluetooth conectados + bateria (somente leitura, system_profiler)
  updates.js         # consulta o último release estável no GitHub (versão, URL, SHA-256 do asset); só metadados
  updateInstaller.js # atualização dentro do app: baixa, confere SHA-256, monta o DMG e entrega a troca a um script auxiliar
  migrate.js         # 1ª abertura após o renome: copia dados de limpa-mac e remove o LaunchAgent antigo
  folders.js         # divisão do espaço usado por pastas da home (gráfico do disco; somente leitura, só por clique)
  categories/
    index.js         # registra todas as categorias
    caches.js
    logs.js
    chromeServiceWorker.js
    trashOld.js
    devCaches.js      # brew / npm / pip (cada um só se instalado)
    downloadsLarge.js # só lista
    whatsapp.js       # só mede, orienta e abre o app (nunca apaga)
    chromeIndexedDB.js# só mede e orienta
ui/
  index.html
  styles.css
  renderer.js
  performance.js / performance.css # aba Desempenho e confirmação de processos/serviços
  photos.html / photos.css / photos.js # revisão de fotos em janela redimensionável
  calangoclean-silhueta.png  # máscara da silhueta (rodapé e cabeçalho), gerada por scripts/make-icons.js
assets/
  calangoclean-icon-base.png # base do ícone do app (quadrado arredondado lilás)
  calangoclean-silhueta.png  # silhueta preta, fundo transparente
  iconTemplate.png / @2x     # ícone da barra de menu (18 e 36 px), gerado da silhueta
  logo-sejacalango.svg       # logo da marca Seja Calango (referência; não é usado na UI)
build/
  icon.png / icon.icns       # ícone do app (1024 e .icns), gerado por scripts/make-icons.js
scripts/
  make-icons.js              # gera todos os ícones (rodar com o Electron)
```

Cada categoria é um módulo com esta interface:
```js
module.exports = {
  id: 'caches',
  label: 'Caches de apps',
  level: 'seguro' | 'atencao' | 'revisar' | 'manual',
  defaultEnabled: true,
  async detect() {},   // true se se aplica neste Mac
  async measure() {},  // bytes que seriam liberados
  async clean({ dryRun }) {}, // retorna { freedBytes, skipped, reason }
  async note() {},     // (opcional) texto dinâmico para a descrição do card
  hint: ''             // texto de orientação (para 'manual')
};
```
Adicionar uma categoria nova = criar um arquivo e registrá-lo em `categories/index.js`.

## Categorias
| id | Rótulo na UI | O que faz | Nível | Padrão |
|---|---|---|---|---|
| caches | Caches de apps | Apaga conteúdo de `~/Library/Caches` | seguro | marcado |
| logs | Logs | Apaga conteúdo de `~/Library/Logs` | seguro | marcado |
| chromeServiceWorker | Cache do Chrome | Apaga `.../Chrome/Default/Service Worker/CacheStorage`; mede sempre, mas **pula a limpeza se o Chrome estiver aberto** (`pgrep -x "Google Chrome"`) | seguro | marcado |
| trashOld | Lixeira | Tamanho principal = bytes a excluir; descrição normal vazia, sem repetir o tamanho ou explicar o prazo. Mantém o seletor Tudo, 7, 15 ou 30 dias. Com Tudo, usa a listagem e o comando nativos do Finder (inclui itens já descartados nos volumes montados), somente após medir e confirmar; exige autorização de Automação para controlar o Finder. Com prazo, limpa somente os itens elegíveis de `~/.Trash` usando ctime. Medição incompleta mostra — e o motivo, nunca 0 B como se fosse completo. Revalida o conteúdo após limpar; falhas exibem nome, motivo e status parcial/failed no card, resultado e histórico. | atencao | marcado |
| devCaches | Caches de dev | `brew cleanup -s`, `npm cache clean --force`, `pip3 cache purge` — cada um só aparece se o comando existir; PATH inclui Homebrew e nvm | seguro | desmarcado |
| downloadsLarge | Downloads grandes e antigos | **Só lista** arquivos > 500 MB com mais de 60 dias em `~/Downloads`; botão "Mostrar no Finder" por arquivo | revisar | — |
| whatsapp | WhatsApp | **Só mede** `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared` e orienta limpar pelo app. Acima de 1 GB (`highlightAbove`) o card sobe para a lista principal, com botão **Abrir WhatsApp** (`open -a WhatsApp`) | manual | — |
| chromeIndexedDB | Chrome IndexedDB | **Só mede** e lista os 5 maiores sites; orienta limpar em `chrome://settings/content/all` | manual | — |

## Regras de segurança (inegociáveis)
1. Nada é apagado sem o usuário ver o tamanho e clicar em **Limpar**.
2. Limpeza real por padrão em novas instalações; Lixeira marcada com prazo de 7 dias. Na primeira abertura da 0.3.3, configurações antigas passam uma única vez para `dryRun: false` (`productionModeVersion: 1`), preservando as demais preferências. Modo `dryRun` em todas as categorias; testes rodam sempre em dry-run ou em pastas temporárias. O `dryRun` é lido do `config.json` no processo principal; o painel nunca consegue alterá-lo.
3. Nunca apagar fora de caminhos explicitamente listados nas categorias. Validar caminho resolvido (`path.resolve`) antes de qualquer `fs.rm`; abortar se não começar com o prefixo esperado.
4. Nunca seguir symlinks ao apagar.
5. O agendamento automático executa **apenas** categorias de nível `seguro` que o usuário marcou. `atencao`, `revisar` e `manual` nunca rodam sozinhas, e o processo principal recusa limpar `revisar`/`manual` mesmo se o painel pedir.
6. Nunca usar `sudo`. Nunca tocar em `/System`, `/Library`, `/private`.
7. Registrar cada execução (inclusive simulação) em `~/Library/Application Support/calangoclean/history.log`.
8. **Discos externos são somente leitura**, exceto a operação nativa de esvaziar a Lixeira solicitada pelo usuário. A remoção direta (`fs.rm`/`unlink`) em `/Volumes` continua proibida. Na opção Tudo, o app mede a listagem da Lixeira fornecida pelo Finder e, só após a confirmação, chama o comando fixo Esvaziar Lixeira, que inclui os itens já descartados nos volumes montados. Nenhum caminho nem script vem do painel. A ação Ejetar continua restrita aos volumes externos/removíveis revalidados por `volumes.js`.
9. **O teste de velocidade só roda por clique do usuário** (consome banda, ~20 s). Nunca automático, nunca no agendamento: `cli.js` e `scheduler.js` não importam `network.js`. Links externos (ex.: "por Seja Calango") abrem só no navegador padrão, com URL fixa no processo principal.
10. **O app nunca apaga nada do WhatsApp** (`~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared`): a categoria é somente leitura (`clean` recusa mesmo com `dryRun: false`), o nível `manual` nunca é limpo pelo painel nem pelo agendamento, e a única ação é **abrir o app** (`open -a WhatsApp`, sem argumentos vindos do painel). Apagar por fora corrompe o histórico; o usuário limpa pelo próprio WhatsApp.

11. **A atualização do app só acontece por clique em Atualizar**, confere o SHA-256 publicado na release antes de abrir o arquivo, nunca roda no agendamento nem por `cli.js`, e mantém a versão instalada intacta em qualquer falha (ver "Atualização dentro do app").

## Configuração
`~/Library/Application Support/calangoclean/config.json`:
```json
{
  "dryRun": false,
  "categories": { "caches": true, "logs": true, "chromeServiceWorker": true, "trashOld": true, "devCaches": false },
  "trashDays": 7,
  "schedule": { "enabled": true, "weekday": 1, "hour": 8, "minute": 30, "minDaysBetween": 5 },
  "lastRun": null
}
```
Regras do `config.js`: os **padrões só valem quando o arquivo não existe** (primeira instalação). Com o arquivo existente, o app grava apenas as chaves que mudou, nunca injeta padrões; se o arquivo existir mas estiver ilegível (JSON inválido, vazio, sem permissão), nada é gravado nem apagado e o app trata como `dryRun: true` só para exibir. O app nunca descarrega o agendamento por conta própria ao abrir; só quando o usuário desliga o interruptor, e essa mudança fica registrada no `history.log`.

## Agendamento
- `scheduler.js` gera o plist em `~/Library/LaunchAgents/com.<appid>.auto.plist` com o caminho real do executável (nunca usuário fixo).
- `RunAtLoad: true` + `StartCalendarInterval` (dia/hora da config).
- O modo `--auto` (em `cli.js`) só executa se `lastRun` tiver `minDaysBetween` dias ou mais; senão registra "nada a fazer" e sai.
- Ao final, mostra notificação nativa com o espaço liberado.
- Ativar/desativar pela UI chama `launchctl bootstrap` / `launchctl bootout`.

## UI (janela do menubar, 420px de largura, altura máxima de 660px)
- **Navegação por abas (0.4.1)**, agora em **barra lateral esquerda só com ícones** (`panel-nav`, 36 px, posicionada em `.app`; o nome de cada ferramenta fica no tooltip à direita do ícone e no `aria-label`; Ajustes fica no fim da coluna; **Duplicados** é o 2º ícone e abre a janela maior; ícones `nav*` em `ui/icons.js` são traços próprios no estilo dos demais). Ordem (`data-view`): **Limpeza** (disco, status, candidatos, Para revisar, resultado), **Dispositivos** (gráfico do disco, discos externos, Bluetooth, rede), **Agenda** (limpeza automática) e **Ajustes** (aparência, permissões, atualizações, conta Seja Calango). Rodapé com Analisar/Limpar fixo. Sem rolagem horizontal em 420×660, 320×568 e 420×520. Os itens abaixo descrevem os componentes; onde falam de linha de status ou da seção Agendamento num painel único, leia-os dentro da aba correspondente.
- Cabeçalho: silhueta do calango varrendo (máscara `ui/calangoclean-silhueta.png` na cor de destaque, 22 px) e o nome "CalangoClean", selo "Simulação" (quando dryRun) e botão sair.
- "Saúde do disco: Boa / Atenção / Crítica" (até 80%, até 90%, acima de 90%) com cor por estado; modelo do Mac abaixo em texto pequeno.
- Card do disco compacto: ícone de HD, nome do volume e "X GB disponível" na mesma linha; barra fina (6px); "Usado / Total" e percentual numa linha pequena. **Clicar no card expande o gráfico de rosca** (ver abaixo).
- **Gráfico do disco** (clique no card do Macintosh HD; `folders.js`): rosca com a divisão do espaço usado em Aplicativos (`/Applications` e `~/Applications`), Documentos, Downloads, Filmes, Imagens, Biblioteca (`~/Library`) e **Sistema e outros** (= usado − soma das demais). Ao lado, a lista com tamanhos e botão "Mostrar no Finder" por pasta (o painel manda só o id; o caminho é fixo no processo principal; "Sistema e outros" não tem botão). A medição (`du -skP`, sem seguir symlinks) **só roda por clique** (na primeira abertura, ou em "Analisar de novo"), mostra "Analisando…" com botão Cancelar, e o último resultado fica em `~/Library/Application Support/calangoclean/folders.json` com a data. **Somente leitura: nunca apaga nada**; `cli.js`/`scheduler.js` não importam `folders.js`.
- **Linha de status única** logo abaixo do card do Macintosh HD (e do gráfico, quando aberto), numa só linha, sem quebra: o chip de rede (ícone e Wi-Fi/Ethernet/VPN; vem **primeiro**, para nunca ser empurrado para fora), os chips de disco externo (ícone e "X GB" livres) e, à direita, os aparelhos Bluetooth. Clicar num chip de disco ou de rede abre o detalhe logo abaixo; clicar de novo fecha; só um aberto por vez. Um disco que sai fecha o detalhe dele. A lista de limpeza ocupa o espaço que sobrar.
  - **Disco externo** (pendrive, SSD, HD): um chip por volume montado em `/Volumes` que seja externo ou removível (`diskutil info -plist`). Ignora o disco do sistema, volumes ocultos, snapshots do Time Machine e imagens `.dmg` montadas. Detalhe: formato, "X GB disponível", barra fina, "Usado / Total" e botão **Ejetar** (`diskutil eject`; se estiver em uso, erro amigável com o programa que o segura, e o chip ganha um aviso). A lista se atualiza sozinha (`fs.watch` em `/Volumes` com debounce + polling de 5 s com a janela aberta). Somente leitura: nenhuma limpeza atua nesses discos (regra 8).
  - **Bluetooth**: o **ícone do tipo** de cada aparelho **conectado** (teclado, mouse, fone, controle; senão Bluetooth) com **anel de bateria** em volta e o **percentual curto ao lado** ("93%"), sem nome na linha; o nome fica no tooltip. Sem dado de bateria: só o ícone (tooltip "sem dados da bateria"). Anel vermelho abaixo de 20%. Os que não couberem viram "+N", com tooltip listando os restantes. Fonte: `system_profiler SPBluetoothDataType -json` **cruzado por endereço com `ioreg -r -k BatteryPercent -l`** (teclados/mouses Apple só informam a bateria pelo ioreg), em `bluetooth.js`; somente leitura, sem ações; `cli.js`/`scheduler.js` não o importam. O nome é o de Ajustes > Bluetooth; se vier um MAC como nome, procura outros campos e só então usa "Dispositivo Bluetooth". Atualiza ao abrir a janela e a cada 30 s com ela visível.
  - **Rede**: tipo da conexão ativa (a interface da rota padrão: Wi-Fi, Ethernet ou VPN), nome da rede Wi-Fi só quando o macOS o fornecer (ele oculta o SSID sem permissão de Localização; sem nome, mostra só o tipo e explica no tooltip) e IP local, com leitura leve repetida a cada 10 s com a janela aberta. Detalhe: botão **Testar velocidade**, que roda `networkQuality -c` sob demanda e mostra download, upload (Mbps/Gbps) e latência (ms) em pt-BR, com "Testando… (~20 s)"; o chip mostra "Testando…" mesmo com o detalhe fechado. Erro amigável se não houver internet (o `networkQuality` sai com código 0 e devolve `error_code` no JSON, então o erro é lido do JSON). Nunca roda sozinho nem no agendamento (regra 9). Não usa ping.
- **Sem Acesso Total ao Disco, o app não tenta ler pastas de outros apps** (Group Containers do WhatsApp, Chrome): as categorias `whatsapp`, `chromeIndexedDB` e `chromeServiceWorker` (`needsFullDisk`) nem fazem stat/readdir/du nelas e mostram só "⚠ Sem permissão", para o macOS não avisar que o app "tentou acessar dados de outros apps". A checagem (`disk.hasFullDiskAccess`) lê só pastas do próprio macOS que exigem Acesso Total (`~/Library/Safari`, `Messages`, `Mail`), cuja negação é silenciosa; sem resposta, assume que não tem. No gráfico do disco, sem a permissão a Biblioteca é medida sem `Containers` e `Group Containers` e aparece como "Biblioteca (parcial)".
- Banner único de permissão com botão Dar acesso: abre Acesso Total ao Disco para pastas protegidas ou Automação quando faltar autorização para controlar o Finder. Os destinos são fixos no main. Cards sem permissão mostram ⚠ Sem permissão e o motivo completo no tooltip; o banner some quando a autorização existir.
- Lista "Candidatos a limpeza": cards com ícone próprio, título 13px semibold, descrição 11px em uma linha (texto completo no tooltip), selo do nível, tamanho (tabular-nums) e interruptor.
  - **O interruptor pode ser ligado mesmo quando o valor elegível é 0 B** (vale para todas as categorias com interruptor): a escolha fica salva no `config.json` para as próximas análises. Só entra no total o que tem bytes para apagar; o botão **Limpar selecionados** habilita se houver bytes ou itens elegíveis na Lixeira (inclusive arquivos vazios e links).
- **WhatsApp em destaque**: quando passa de 1 GB (base 10), o card sai de "Para revisar" e vai para a lista principal, logo abaixo das categorias com interruptor, com selo "Manual". No lugar do interruptor, o botão **Abrir WhatsApp** (`open -a WhatsApp`, comando fixo no processo principal; o botão some se o app não estiver instalado) e a descrição em uma linha: "Limpe em Ajustes > Armazenamento > Gerenciar armazenamento". Até 1 GB (inclusive), o card continua em "Para revisar". Só mede: nunca apaga (regra 10).
- Seção recolhível "Para revisar" (fechada por padrão) com os cards `revisar` e `manual`, sem interruptor.
- Rodapé fixo: "Seria liberado / Liberado", botões **Analisar** e **Limpar selecionados** (confirmação com o total; avisa se houver itens de atenção).
- **"Powered by"**: linha discreta abaixo dos botões: a **silhueta do calango** (`calangoclean-silhueta.png`, 16 px, pintada com a cor secundária via máscara CSS) seguida de "por Seja Calango" (10,5 px, cor secundária, destaque no hover), **tudo um botão só**; 13 px de altura de linha, sem crescer o rodapé; linha própria que não compete com os botões de limpeza. Ao clicar, abre https://sejacalango.com.br no navegador padrão via `shell.openExternal` (URL fixa no processo principal); o app nunca navega nem abre janelas por conta própria (links vão sempre para o navegador).
- Seção "Agendamento": ligar/desligar, dia e hora.
- Tooltips próprios: atraso de 600 ms e nunca cobrem outros controles (o do card do disco abre acima dele, para não cobrir a linha de status).
- Números em pt-BR (`Intl.NumberFormat('pt-BR')`), plural correto, sem scroll horizontal. Tamanhos em **base 10** (1 KB = 1000 bytes), como o Finder; uma casa decimal (ex.: "34,3 GB").
- **Aparência compartilhada (0.4.1):** seletor Normal / Noturno / Automático; `appearance` persiste via fila de config. `nativeTheme.themeSource` é light / dark / system; eventos atualizam painel e duplicados. A escolha só altera este app. Tokens claro/escuro preservam lilás da marca e cores de estado. O layout usa abas Limpeza / Dispositivos / Agenda / Ajustes; Duplicados abre a janela maior existente. Login na Seja Calango é opcional, abre URL fixa no navegador e não estabelece sessão dentro do app.

## Atualização dentro do app (0.4.4)

- **Consulta** (`src/updates.js`): `https://api.github.com/repos/PabloTDias/calangoclean/releases/latest` ao iniciar e ao abrir o painel, no máximo 1 vez a cada 6 h (o limite fica no `updates.js`; "Verificar atualizações" em Ajustes força). Compara a tag com a versão instalada (`app.getVersion()`). Só release estável (não draft/prerelease) com asset `CalangoClean.dmg` (ou `CalangoClean-<versão>-universal.dmg`) **e `digest` `sha256:<64 hex>` publicado pelo GitHub**; sem o digest a atualização não é oferecida (não há como conferir o arquivo). Notificação nativa uma vez por versão por sessão.
- **UI**: banner no topo "Nova versão X disponível" com o botão **Atualizar**. Ao clicar: "Baixando atualização… N%" com barra → "Verificando SHA-256…" → "Preparando o instalador…" → "Reiniciando para concluir…". Em falha, o banner mostra o erro e o botão vira "Tentar de novo". Sem janelas de confirmação extras. **Nunca atualiza sozinho:** o único gatilho é o IPC `updates:install`, aceito só do painel principal; o renderer não envia URL, hash nem caminho (tudo vem da última consulta validada no main).
- **Fluxo** (`src/updateInstaller.js`): (1) valida o local: só `CalangoClean.app` instalado, fora de DMG/AppTranslocation, com pasta de destino gravável (em desenvolvimento a atualização é recusada); (2) baixa o DMG para uma pasta temporária privada `calangoclean-update-*` (0700) — HTTPS apenas, hosts `github.com` e `*.githubusercontent.com`, até 5 redirecionamentos, timeout de inatividade de 30 s, tamanho igual ao do asset; (3) confere o **SHA-256** calculado durante o download com o `digest` da release; se não bater, apaga tudo, registra `failed`, avisa e **nunca monta** o arquivo; (4) `hdiutil attach -nobrowse -readonly` num mountpoint próprio e valida o app dentro (bundle id `com.sejacalango.calangoclean`, versão igual à anunciada, `codesign --verify --deep --strict`); (5) recusa se houver limpeza em andamento (`mutationGate.isBusy`); (6) grava e dispara, desvinculado, o script auxiliar (`/bin/bash`, argumentos por posição, nada interpolado) e encerra o app (`app.quit`, com `app.exit` de reserva após 5 s).
- **Script auxiliar**: espera o PID encerrar (até 60 s; se não encerrar, nada é alterado), `ditto` da nova versão para um staging oculto ao lado do destino, confere versão e assinatura da cópia, renomeia o app atual para um nome oculto de rollback, move o staging para `CalangoClean.app`, **desfaz a troca** se qualquer passo falhar, ejeta o disco, apaga o DMG e a pasta temporária, remove o rollback e reabre o app. Em qualquer falha a versão instalada permanece intacta e o app antigo é reaberto. Nunca usa `sudo`.
- **Resultado e histórico**: tudo vai para `history.log` (`update | appUpdate`): pedido do usuário, download e SHA-256 conferido, instalador validado, reinício, app encerrado, instalação concluída ou `failed (motivo)`. O script grava `update-result.json` em `~/Library/Application Support/calangoclean`; na abertura seguinte o main lê e apaga o arquivo e o painel mostra "CalangoClean atualizado para a versão X" ou o erro da tentativa (mantendo a versão anterior).
- **Permissões herdadas**: o macOS guarda o Acesso Total ao Disco pelo requisito de código, e a assinatura ad-hoc padrão (`cdhash`) muda a cada build. `scripts/afterSign.js` (hook `afterSign` do electron-builder) regrava só a assinatura do app principal com o requisito estável `designated => identifier "com.sejacalango.calangoclean"`; assim a permissão concedida a uma versão vale para as próximas atualizadas pelo app. Vale a partir do 1º build com esse hook (quem vem de versão anterior concede uma última vez). Limite: qualquer app ad-hoc com o mesmo identificador satisfaria o requisito; o certo é o Developer ID (roadmap 3), que torna o hook desnecessário. Verificação: `codesign -d -r- CalangoClean.app`.
- **Acesso Total ao Disco**: trocar o app pode invalidar a permissão. Na primeira abertura após uma atualização concluída, se `disk.hasFullDiskAccess` falhar, o banner de permissão aparece com **Dar acesso** ("Depois da atualização, o CalangoClean precisa de Acesso Total ao Disco de novo"); o banner normal por categorias continua valendo depois.
- `cli.js`/`scheduler.js` não importam `updates.js` nem `updateInstaller.js` (nada de atualização no agendamento).
- Teste ponta a ponta feito na 0.4.4: cópia 0.4.4 fora de `/Applications` + release temporária v0.4.5 (depois apagada, com a tag) → banner, download com progresso, SHA-256, troca, reabertura em 0.4.5, DMG/volume/temporários removidos, `history.log` completo. Falha de SHA-256, id/versão errados, hosts não permitidos, limpeza em andamento e rollback do script têm testes automatizados (`tests/updateInstaller.test.js`). Uma release de teste na conta pública aparece como "Latest" para quem estiver rodando o app: publicar só por pouco tempo e apagar release e tag em seguida.

## Fotos e arquivos duplicados (0.4.0)

- Botão próprio no painel abre uma janela única, móvel e redimensionável, independente do menubar; fechar oculta e preserva a revisão. Abas **Fotos duplicadas** e **Arquivos duplicados**, com scanners, raízes, resultados e IDs separados no main. Trocar de modo limpa seleção e confirmação. A janela só abre por pedido do usuário. Esta ferramenta não é uma categoria de limpeza nem participa do agendamento.
- Busca só após clicar, em Imagens, Downloads ou pastas pessoais locais escolhidas no diálogo nativo. O renderer só envia IDs, nunca caminhos de remoção. Bloqueia sistema, Library, aplicativos, pacotes/fototecas, projetos e nuvem reconhecidos, links, hardlinks e outros volumes. Fotos com sidecars/Live Photos são preservadas.
- Allowlist de imagens raster com assinatura de conteúdo, tamanho, SHA-256, comparação integral em blocos e metadados estendidos equivalentes. Fotos parecidas ou editadas não são duplicatas exatas. Progresso e cancelamento; cancelar invalida qualquer seleção anterior.
- Arquivos: allowlist de documentos, vídeos, áudios e compactados; somente pastas pessoais aprovadas, Downloads selecionada inicialmente. DLLs, executáveis, bibliotecas, scripts, instaladores, fontes, bancos de dados e arquivos sem extensão são excluídos antes da leitura do conteúdo. Recusa permissão de execução e assinaturas de PE/Mach-O/ELF/shebang mesmo renomeados. Não executa, descompacta, navega nem gera QuickLook de documentos; mostra ícones de tipo. Preserva pares de vídeos/imagens e arquivos auxiliares.
- Todas as remoções começam desmarcadas; pelo menos uma cópia por grupo deve permanecer. Antes de agir, revalida caminhos, identidade, metadados e conteúdo de alvos e da cópia mantida. Dados alterados exigem nova busca.
- Só `shell.trashItem`, após confirmação e respeitando `dryRun` lido no main; nunca usa remoção definitiva como alternativa. A operação compartilha bloqueio com a limpeza comum, registra histórico e invalida a confirmação anterior da Lixeira. Não esvazia a Lixeira em seguida nem contabiliza espaço liberado.
- Miniaturas nativas são retornadas como imagens em dados; a janela tem preload e IPC próprios, CSP e validação de sender/frame. Arquivos internos da fototeca não são alterados; botão abre o Fotos com identificador fixo.
- `npm run preview:photos` abre a mesma janela com fixtures temporárias de imagens do macOS, sempre em simulação, sem configuração, agendamento ou fotos pessoais. Testes de remoção usam somente fixtures e Lixeira fake.

## Ícones
- **Ícone do app**: `scripts/make-icons.js` recorta o quadrado arredondado de `assets/calangoclean-icon-base.png` (os cantos brancos viram transparentes), redimensiona para 824×824 centralizado num canvas transparente de 1024×1024, aplica a máscara de cantos dos ícones do macOS e gera `build/icon.png` e `build/icon.icns`.
- **Barra de menu**: `assets/iconTemplate.png` (18 px) e `iconTemplate@2x.png` (36 px) = o **calango varrendo** (`assets/calangoclean-silhueta.png`, não a lagartixa de `FiveIcon Calango.png`, que só gera o `ui/favicon.png`), silhueta preta com fundo transparente (template image; o macOS pinta conforme o tema), ao lado do texto do espaço livre.
- Para regenerar: `env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/make-icons.js`.

## Migração (limpa-mac → calangoclean; o nome de exibição CalangoClean não exige nova migração)
Na primeira abertura (`src/migrate.js`, antes de ler o config e de instalar o agente novo): se existir `~/Library/Application Support/limpa-mac`, copia `config.json`, `history.log` e `folders.json` para a pasta nova (sem apagar a antiga e sem sobrescrever o que já existir na nova); descarrega (`launchctl bootout`) e apaga o plist do LaunchAgent antigo `com.limpa-mac.auto`; registra a migração no `history.log`. É idempotente: depois de feita, não faz nada nem registra de novo.

## Build
- `npm start` → roda local.
- `npm run dist` (`scripts/dist.js`) → `dist/CalangoClean-<versão>-universal.dmg` via electron-builder, sem assinatura (fase 1). **Antes** de cada build apaga todo o conteúdo de `dist/`; **ao final**, verifica a integridade com `hdiutil verify` e mantém só o `.dmg` da versão nova. Em falha de geração/verificação, remove os intermediários e o DMG incompleto. Recusa `dist/` como symlink.
- **Todo build sai só em `dist/`** (`npm run dist` apaga `dist/` antes e mantém só o `.dmg` da versão atual). `output/` nunca recebe cópias do app: não existem `output/build-<versão>` nem `output/backups`, e nenhum script deve recriá-los. `output/build-cache` é só cache do electron-builder (não é cópia do app); `output/validation` e `output/previews` guardam evidências.
- **Política de atualização aprovada pelo Pablo:** substituir `/Applications/CalangoClean.app`, sem acumular versões anteriores. Para instalação local, usar `npm run install:local -- <origem.app>` (`scripts/install-local.js`) com origem no DMG montado e app fechado. Valida identidade, versão, assinatura e destino; staging e rollback ocultos temporários ficam junto do destino. Reverte em falha; após validar a nova instalação, exclui a anterior e os temporários. Nenhum backup permanente em `output/backups`, nenhum build completo permanente em `output/build-<versão>`. Preferências, histórico e agendamento preservados. Pendências de recuperação/limpeza são informadas, nunca escondidas. Os scripts por versão em `output/validation` são apenas evidência histórica; não reutilizar. Não apagar cópias antigas já existentes sem um pedido específico.
- Fase 2: configurar `mac.hardenedRuntime`, `notarize` e certificado Developer ID.

## Observações para o usuário final
- Na primeira execução, o macOS bloqueia apps não assinados: Ajustes > Privacidade e Segurança > "Abrir Mesmo Assim".
- Para limpar a Lixeira, o Chrome e medir o WhatsApp, o app precisa de "Acesso Total ao Disco" (em desenvolvimento, a permissão vem do VS Code).

## Ordem de implementação
1. ✅ Esqueleto Electron + menubar abrindo a janela.
2. ✅ `disk.js` + 3 categorias seguras (caches, logs, chromeServiceWorker) com `measure` e `clean({dryRun})`.
3. ✅ UI de análise e limpeza com confirmação.
4. ✅ `config.js` + persistência das escolhas.
5. ✅ Categorias restantes.
6. ✅ `cli.js --auto` + `scheduler.js` + seção Agendamento na UI.
7. ✅ Primeira limpeza real (dryRun false) só com Caches e Logs, para validar.
8. Build do `.dmg` e teste no Mac do irmão.

## Versão 2 ✅ (implementada na 0.2.0)
### Card "Rede"
- Mostra tipo de conexão ativa (Wi-Fi ou Ethernet) e IP local — leitura leve, sem teste.
- Botão "Testar velocidade" roda sob demanda `networkQuality -c` (nativo do macOS, saída JSON) e mostra download, upload e latência.
- Nunca roda automaticamente nem no agendamento (consome banda, ~20 s).
- Fica abaixo do card de disco; o topo continua dedicado à saúde do disco.
- Não usar ping como "teste de velocidade" (ping mede só latência).
- Implementação: `src/network.js`; o teste só é chamado pelo IPC `network:speed` (clique do usuário), e `cli.js`/`scheduler.js` nunca importam esse módulo.

## Roadmap (depois da Versão 2, nesta ordem)
> Os estados abaixo distinguem entregas e pendências. Não implementar itens pendentes sem o Pablo pedir.

1. **Interruptor "Modo simulação" no painel** — liga/desliga o `dryRun` com confirmação ao desligar ("A partir de agora os arquivos serão apagados de verdade"). Decisão do Pablo: altera a regra 2 (o painel passa a poder mudar o `dryRun`, mas só por esse interruptor e com confirmação).
2. **Primeira abertura guiada** — tela de boas-vindas que explica o modo simulação e as permissões (Acesso Total ao Disco), com botão "Dar acesso".
3. **Notarização Apple** — quando houver conta Apple Developer (US$ 99/ano): Developer ID, `hardenedRuntime`, `notarize` no electron-builder. Remove o "Abrir Mesmo Assim".
4. ✅ **Atualização dentro do app (0.4.4; avisos desde a 0.3.2)** — ver a seção "Atualização dentro do app" abaixo. Sem electron-updater (o app não tem assinatura da Apple). Só com o clique do usuário.
5. ✅ **Maiores pastas** (implementado como o gráfico de rosca do card do disco; ver UI > Gráfico do disco).
6. ✅ **Chip de dispositivos Bluetooth com bateria** (implementado; ver UI > Bluetooth). Decisão do Pablo: mostra também os que não informam bateria, com "sem dados da bateria".
7. ✅ **Gerenciador de processos** (aba **Desempenho**; implementado após a 0.4.2, autorizado pelo Pablo; base para o fechamento de apps e LaunchAgents do Desinstalador):
   - Agrupa apps e auxiliares pelo bundle externo e soma CPU/RSS (nome, ícone, CPU, memória, tempo aberto), com pressão de memória do macOS. Lista, marcadores e gráficos são consultados a cada 500 ms somente com a aba e o painel visíveis; pressão usa cache de 5 s; pausa durante confirmações e operações. Serviços só ao entrar na aba. Não há botão Atualizar em Desempenho; ações usam × com nome acessível e confirmação.
   - Encerra só apps e processos **do usuário atual**: `SIGTERM` primeiro; "Forçar encerramento" (`SIGKILL`) como segundo passo, com aviso de trabalho não salvo.
   - O painel manda só o PID representativo e o token; o main resolve o grupo, prende os membros revisados na confirmação e revalida dono, caminho e hora de início de todos antes de agir (evita PID reaproveitado). A confirmação mostra quantos processos inclui.
   - Sem botão para root, outros usuários, processos do sistema (`launchd`, `WindowServer`, `kernel_task`, Finder, Dock) nem o próprio CalangoClean. Nunca `sudo` (regra 6).
   - Sempre com confirmação; nunca automático nem no agendamento; `cli.js`/`scheduler.js` não o importam.
   - Serviços: lista os LaunchAgents do usuário (`~/Library/LaunchAgents`) em execução e permite descarregar (`launchctl bootout`); serviços do sistema ficam de fora.
   - `src/performance.js` não coleta na inicialização. Tokens de confirmação são de uso único, expiram em dois minutos e vinculam PID, dono real/efetivo/salvo, caminho, início, modo e tipo de encerramento. SIGKILL só após SIGTERM real anterior para a mesma identidade. Protege também ancestrais e descendentes do próprio processo.
   - Serviços exigem plist regular do usuário, sem symlink/hardlink e sem escrita de terceiros, com Label, conteúdo e origem do job revalidados antes de descarregar. Nunca apaga o plist. Ações respeitam `dryRun`, o bloqueio de operações manuais e o histórico. Ícones dos apps instalados (helpers usam o app pai), com fallback genérico; busca aceita qualquer PID do grupo; cabeçalhos ordenam nos dois sentidos e acompanham cada leitura. Gráficos mostram CPU/RAM do último minuto e barras mostram porcentagem da RAM total por app.
   - Validação: `docs/desempenho-validacao.md`; testes e imagens em `output/validation/performance-0.4.2/`.
8. **Versão 3: Desinstalador** (aba **Apps**) — regras obrigatórias:
   - Lista apps de `/Applications` e `~/Applications` com ícone, tamanho e último uso; apps da Apple e do sistema aparecem sem botão.
   - Mover para a Lixeira (`shell.trashItem`), nunca apagar direto; registrar no `history.log`; respeitar `dryRun`.
   - Correspondência exata pelo bundle ID do app, nunca por parte do nome.
   - Procurar só em `~/Library` (Application Support, Caches, Preferences, Containers, Logs, Saved Application State, LaunchAgents do usuário) e em Group Containers que pertençam apenas a esse app.
   - Mostrar o total e cada arquivo encontrado, todos marcados e desmarcáveis, antes de mover.
   - Não tocar em Group Containers compartilhados por mais de um app, nem em apps da Apple ou do sistema.
   - Fechar o app (com confirmação) e descarregar os LaunchAgents dele antes de mover qualquer coisa.
   - O painel manda só o ID do app; o main refaz a busca e revalida os caminhos antes de mover.
   - Sem `sudo`: apps em `/Library`/`/private` ou que exijam senha de administrador ficam fora, com aviso (regra 6). Nunca remove o CalangoClean.
   - Só por clique; fora do agendamento e da limpeza em lote.

### Distribuição
- Canal principal: sejacalango.com.br, notarizado, gratuito ou "pague quanto quiser".
- Mac App Store fora do escopo por enquanto: o sandbox obrigatório bloqueia Acesso Total ao Disco, limpeza de caches de outros apps, LaunchAgents e comandos externos.

## Desinstalar aplicativos e limpeza sem navegadores (0.4.2)

- `src/applications.js` lista bundles de /Applications e ~/Applications, incluindo subpastas (até quatro níveis), e /System/Applications em modo somente leitura. Não entra em bundles, não segue atalhos e não percorre pastas pessoais arbitrárias. Última abertura via Spotlight em `src/appUsage.js`; data ausente é desconhecida, nunca "nunca usado". Lista com rolagem da página. IDs e tokens opacos, revalidação, bloqueio Apple/self/emuso/estruturainválida/helpers e extensões. Apenas shell.trashItem para apps elegíveis; nunca remove dados de Library nem usa sudo.
- A aba Apps usa ui/applications.js/css; só lista ao pedido, mede na revisão, confirma envio, preserva dados e permite simulação. Troca de aba/ESC invalida revisão pendente.
- Na confirmação comum, Limpar sem fechar navegadores filtra todas categorias requiresBrowserQuit, envia skipBrowsers=true e closeBrowsers=false; backend também aplica skipBrowsers. Fechar e limpar mantém autorização explícita. × e Escape cancelam sem executar.

## Refinamentos após a prévia de Desempenho

- Desempenho exibe somente processos com ação de encerramento e serviços que podem ser descarregados. As proteções permanecem no backend.
- Dispositivos abre SSD principal, discos externos, rede e Bluetooth recolhidos; cabeçalhos expandem por clique. Entrar na aba não inicia medição nem teste de velocidade. Discos externos ganham rosca por pastas via du -skPx (somente leitura, sem seguir links ou outras montagens), com cancelamento, cache por identidade da montagem e indicação parcial. IPCs validam sender/frame e aceitam apenas IDs de volumes classificados como externos. Exibição e Atualizações ficam em Ajustes; Sair é o power do topo; rodapé mantém marca/versão.
- Códigos técnicos de limpeza e identificadores internos são resumidos na tela (ex.: "Alguns arquivos foram mantidos"), com detalhes no tooltip, no resultado expansível e no histórico. Estados parcial/failed e bloqueios de medição não são ocultados.
- Evidências: `output/validation/refinamentos-0.4.2/`.

## Ordenação, botão Limpar e conclusão sonora

- Desempenho permite ordenar Nome, CPU e Memória pelos cabeçalhos, nos dois sentidos, acompanhando a leitura automática. Apps aplica ordenação alfabética também no renderer.
- O botão principal se chama Limpar. A confirmação e todas as proteções de limpeza continuam obrigatórias.
- `soundEnabled` vale true por padrão e persiste pela fila de config; Ajustes > Avisos sonoros permite desligar e ouvir uma prévia. O modo dryRun não é alterado por essa opção.
- `src/completionSound.js` toca um WAV próprio curto por comando fixo, sem argumentos de áudio vindos do renderer. O arquivo é incluído e desempacotado no build. Não sobrepõe toques; falhas de áudio não afetam tarefas.
- Só tarefas manuais concluídas emitem o pedido de som, inclusive simulações e resultados parciais. Não toca ao iniciar, abrir abas, atualizar em segundo plano, cancelar ou falhar. Duplicados compartilha a preferência via IPC próprio validado; CLI e agendamento não importam o módulo sonoro.
- Validação e evidências: `docs/ordenacao-som.md`, `output/validation/ordenacao-som-0.4.2/`.

## Privacidade (0.4.3)

- `src/privacy.js` detecta navegadores somente pelos bundles em raízes fixas e valida sua identidade. Aceita apenas IDs conhecidos; não recebe caminhos, scripts ou URLs do painel. Só abre opções nativas ou o navegador com instruções. Não lê, modifica nem apaga históricos, cookies, senhas ou perfis.
- `ui/privacy.js/css` fornece a aba Privacidade. Perfil, período, categorias e confirmação final ficam no navegador. Abertura não conta como limpeza nem dispara o som de conclusão. Sem ações automáticas ou integração com CLI/agendamento. Busca de arquivos pessoais/adultos permanece fora desta entrega.
- Os caches de apps retornam `statusReason` amigável e `statusDetails` técnico separado. `remainingCount` permite apresentar arquivos preservados sem alarme; resultados e histórico mantêm os diagnósticos e estados reais.
- Foram encontradas instâncias instalada antiga e local simultâneas. A conferência desta versão deve usar apenas a local 0.4.3, sem substituir o aplicativo instalado nesta etapa.
- Evidências: `docs/privacidade-0.4.3.md`, `output/validation/privacidade-0.4.3/`.

## Paleta e versão no rodapé

- `ui/theme.css` é a fonte compartilhada das cores, superfícies, bordas e tipografia do painel e de Duplicados. Os CSS específicos definem layout e aliases de componentes, sem duplicar a paleta principal. O fundo nativo da janela de Duplicados acompanha os fundos claro/escuro compartilhados.
- `app:init.version` vem de `app.getVersion()`. O renderer mostra `v<versão>` no rodapé fixo de todas as abas e "Versão <versão>" em Ajustes, sem substituir a versão local por metadados do release remoto.
- A sequência 0.4.x já existia; 0.4.3 foi incremento escolhido pelo Codex para a entrega de Privacidade. Não há registro de decisão do Pablo por 1.3.1. Esta correção mantém 0.4.3.
